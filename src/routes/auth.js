const User = require('../models/User');
const Transaction = require('../models/Transaction');
const LedgerEntry = require('../models/LedgerEntry');
const crypto = require('crypto');
const { getAuthorizationUrl, handleCallback } = require('../services/LogtoService');

const SIGNUP_BONUS = 100;

module.exports = async function authRoutes(fastify) {
    fastify.post('/register', {
        schema: {
            body: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                    email: { type: 'string', format: 'email' },
                    password: { type: 'string', minLength: 6 },
                    username: { type: 'string', minLength: 3, maxLength: 30 },
                    displayName: { type: 'string', maxLength: 50 },
                    referralCode: { type: 'string' }
                }
            }
        }
    }, async (req, reply) => {
        try {
            const { email, password, username, displayName, referralCode } = req.body;

            const existingUser = await User.findOne({ email });
            if (existingUser) {
                return reply.code(400).send({
                    success: false,
                    error: 'An account with this email already exists'
                });
            }

            if (username) {
                const existingUsername = await User.findOne({ username });
                if (existingUsername) {
                    return reply.code(400).send({
                        success: false,
                        error: 'This username is already taken'
                    });
                }
            }

            let referredByUser = null;
            if (referralCode) {
                referredByUser = await User.findOne({ referralCode });
            }

            const user = new User({
                email,
                password,
                username: username || `user_${Date.now().toString(36)}`,
                displayName: displayName || email.split('@')[0],
                referredBy: referredByUser?._id || null
            });

            await user.save();

            if (referredByUser) {
                await referredByUser.addReward(50, 'referral_bonus', 'Referral bonus for inviting a friend');

                try {
                    const NotificationService = require('../services/NotificationService');
                    await NotificationService.notifyReferral(
                        referredByUser._id,
                        referredByUser.displayName || 'A new user',
                        email
                    );
                } catch (err) {
                    console.error('Failed to create referral notification:', err.message);
                }
            }

            await user.addReward(SIGNUP_BONUS, 'signup_bonus', 'Welcome bonus for joining NOOK Rewards');

            const token = fastify.jwt.sign({
                id: user._id,
                email: user.email,
                role: user.role
            });

            reply.setCookie('auth_token', token, {
                path: '/',
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                maxAge: 7 * 24 * 60 * 60
            });

            return reply.send({
                success: true,
                message: 'Registration successful',
                data: {
                    user: user.toPublicJSON(),
                    token,
                    signupBonus: SIGNUP_BONUS
                }
            });

        } catch (error) {
            req.log.error({ error: error.message }, 'Registration failed');
            return reply.code(500).send({
                success: false,
                error: 'Registration failed. Please try again.'
            });
        }
    });

    fastify.post('/login', {
        schema: {
            body: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                    email: { type: 'string', format: 'email' },
                    password: { type: 'string' }
                }
            }
        }
    }, async (req, reply) => {
        try {
            const { email, password } = req.body;

            const user = await User.findOne({ email }).select('+password');
            if (!user) {
                return reply.code(401).send({
                    success: false,
                    error: 'Invalid email or password'
                });
            }

            if (!user.isActive) {
                return reply.code(403).send({
                    success: false,
                    error: 'Your account has been deactivated'
                });
            }

            const isMatch = await user.comparePassword(password);
            if (!isMatch) {
                return reply.code(401).send({
                    success: false,
                    error: 'Invalid email or password'
                });
            }

            user.lastLogin = new Date();
            await user.save();

            if (user.wallet.balanceLastSynced) {
                const latestEntry = await LedgerEntry.findOne({ user: user._id }).sort({ createdAt: -1 });
                if (latestEntry && latestEntry.createdAt > user.wallet.balanceLastSynced) {
                    setImmediate(async () => {
                        try {
                            await user.reconcileWallet();
                        } catch (err) {
                            console.error('Auto-reconciliation failed on login:', err.message);
                        }
                    });
                }
            }

            const token = fastify.jwt.sign({
                id: user._id,
                email: user.email,
                role: user.role
            });

            reply.setCookie('auth_token', token, {
                path: '/',
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                maxAge: 7 * 24 * 60 * 60
            });

            return reply.send({
                success: true,
                message: 'Login successful',
                data: {
                    user: user.toPublicJSON(),
                    token
                }
            });

        } catch (error) {
            req.log.error({ error: error.message }, 'Login failed');
            return reply.code(500).send({
                success: false,
                error: 'Login failed. Please try again.'
            });
        }
    });

    fastify.post('/logout', async (req, reply) => {
        reply.clearCookie('auth_token', { path: '/' });
        return reply.send({
            success: true,
            message: 'Logged out successfully'
        });
    });

    fastify.get('/me', {
        preHandler: [fastify.authenticate]
    }, async (req, reply) => {
        try {
            const user = await User.findById(req.user.id);
            if (!user) {
                return reply.code(404).send({
                    success: false,
                    error: 'User not found'
                });
            }

            return reply.send({
                success: true,
                data: {
                    user: user.toPublicJSON()
                }
            });
        } catch (error) {
            return reply.code(500).send({
                success: false,
                error: 'Failed to fetch user'
            });
        }
    });

    fastify.post('/forgot-password', {
        schema: {
            body: {
                type: 'object',
                required: ['email'],
                properties: {
                    email: { type: 'string', format: 'email' }
                }
            }
        }
    }, async (req, reply) => {
        try {
            const { email } = req.body;
            const user = await User.findOne({ email });

            if (user) {
                const resetToken = user.generatePasswordResetToken();
                await user.save();
                req.log.info({ userId: user._id }, 'Password reset token generated');
            }

            return reply.send({
                success: true,
                message: 'If an account with that email exists, a password reset link has been sent.'
            });
        } catch (error) {
            return reply.code(500).send({
                success: false,
                error: 'Failed to process request'
            });
        }
    });

    fastify.get('/logto/login', async (req, reply) => {
        try {
            const provider = req.query.provider;
            const redirectUri = `${process.env.BASE_URL || 'http://localhost:5050'}/api/auth/logto/callback`;
            const { url, codeVerifier, state, nonce } = await getAuthorizationUrl(redirectUri, provider);

            reply.setCookie('logto_state', JSON.stringify({ codeVerifier, state, nonce }), {
                path: '/',
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                maxAge: 60 * 5
            });

            return reply.redirect(url);
        } catch (err) {
            req.log.error(err, 'Logto login error');
            return reply.redirect('/login?error=social_auth_unavailable');
        }
    });

    fastify.get('/logto/callback', async (req, reply) => {
        try {
            const pkceCookie = req.cookies.logto_state;
            if (!pkceCookie) {
                return reply.redirect('/login?error=auth_expired');
            }

            let pkceParams;
            try {
                pkceParams = JSON.parse(pkceCookie);
            } catch {
                return reply.redirect('/login?error=auth_expired');
            }

            reply.clearCookie('logto_state', { path: '/' });

            const redirectUri = `${process.env.BASE_URL || 'http://localhost:5050'}/api/auth/logto/callback`;
            const userInfo = await handleCallback(
                req.url,
                redirectUri,
                pkceParams.codeVerifier,
                pkceParams.state,
                pkceParams.nonce
            );

            const authUserId = `logto:${userInfo.sub}`;
            const email = userInfo.email;
            const displayName = userInfo.name || (email ? email.split('@')[0] : 'User');
            const avatar = userInfo.picture || null;

            let user = await User.findOne({ authUserId });

            if (user) {
                user.lastLogin = new Date();
                if (avatar && user.avatar !== avatar) user.avatar = avatar;
                if (displayName && user.displayName !== displayName) user.displayName = displayName;
                await user.save();
            } else {
                const existingEmail = email ? await User.findOne({ email }) : null;
                if (existingEmail) {
                    existingEmail.authUserId = authUserId;
                    existingEmail.authProvider = 'logto';
                    existingEmail.lastLogin = new Date();
                    if (avatar) existingEmail.avatar = avatar;
                    if (displayName) existingEmail.displayName = displayName;
                    await existingEmail.save();
                    user = existingEmail;
                } else {
                    user = new User({
                        email: email || `${userInfo.sub}@logto.auth`,
                        authUserId,
                        authProvider: 'logto',
                        displayName,
                        avatar,
                        username: `user_${Date.now().toString(36)}`,
                        lastLogin: new Date()
                    });
                    await user.save();
                }
            }

            const token = fastify.jwt.sign({
                id: user._id,
                email: user.email,
                role: user.role
            });

            reply.setCookie('auth_token', token, {
                path: '/',
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                maxAge: 7 * 24 * 60 * 60
            });

            return reply.redirect('/dashboard');
        } catch (err) {
            req.log.error(err, 'Logto callback error');
            return reply.redirect('/login?error=auth_failed');
        }
    });
};
