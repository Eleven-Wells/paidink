const fp = require('fastify-plugin');
const User = require('../models/User');

async function authPlugin(fastify) {
    fastify.decorate('authenticate', async function(request, reply) {
        const isApiRequest = request.url.startsWith('/api/');
        
        try {
            const token = request.cookies?.auth_token || request.headers.authorization?.replace('Bearer ', '');
            
            if (!token) {
                if (isApiRequest) {
                    return reply.code(401).send({
                        success: false,
                        error: 'Authentication required'
                    });
                }
                
                const acceptHeader = request.headers.accept || '';
                const wantsJson = acceptHeader.includes('application/json');
                
                if (wantsJson) {
                    return reply.code(401).send({
                        success: false,
                        error: 'Authentication required'
                    });
                }
                
                const redirectUrl = encodeURIComponent(request.url);
                return reply.redirect(`/login?redirect=${redirectUrl}`);
            }
            
            const decoded = fastify.jwt.verify(token);
            
            const user = await User.findById(decoded.id);
            
            if (!user) {
                reply.clearCookie('auth_token', { path: '/' });
                
                if (isApiRequest) {
                    return reply.code(401).send({
                        success: false,
                        error: 'User not found. Please login again.'
                    });
                }
                
                const acceptHeader = request.headers.accept || '';
                const wantsJson = acceptHeader.includes('application/json');
                
                if (wantsJson) {
                    return reply.code(401).send({
                        success: false,
                        error: 'User not found. Please login again.'
                    });
                }
                return reply.redirect('/login');
            }
            
            if (!user.isActive) {
                if (isApiRequest) {
                    return reply.code(403).send({
                        success: false,
                        error: 'Account is deactivated'
                    });
                }
                
                const acceptHeader = request.headers.accept || '';
                const wantsJson = acceptHeader.includes('application/json');
                
                if (wantsJson) {
                    return reply.code(403).send({
                        success: false,
                        error: 'Account is deactivated'
                    });
                }
                
                reply.clearCookie('auth_token', { path: '/' });
                return reply.redirect('/login');
            }
            
            request.user = user;
            request.userId = user._id;
            request.session = request.session || {};
            
        } catch (error) {
            if (error.name === 'TokenExpiredError') {
                if (isApiRequest) {
                    return reply.code(401).send({
                        success: false,
                        error: 'Session expired. Please login again.'
                    });
                }
                
                const acceptHeader = request.headers.accept || '';
                const wantsJson = acceptHeader.includes('application/json');
                
                if (wantsJson) {
                    return reply.code(401).send({
                        success: false,
                        error: 'Session expired. Please login again.'
                    });
                }
                
                reply.clearCookie('auth_token', { path: '/' });
                return reply.redirect('/login');
            }
            
            if (isApiRequest) {
                return reply.code(401).send({
                    success: false,
                    error: 'Invalid authentication'
                });
            }
            
            const acceptHeader = request.headers.accept || '';
            const wantsJson = acceptHeader.includes('application/json');
            
            if (wantsJson) {
                return reply.code(401).send({
                    success: false,
                    error: 'Invalid authentication'
                });
            }
            
            return reply.redirect('/login');
        }
    });
    
    fastify.decorate('requirePublisher', async function(request, reply) {
        await fastify.authenticate(request, reply);
        
        const User = require('../models/User');
        const user = await User.findById(request.user.id);
        
        if (!user || user.publisherStatus !== 'approved') {
            return reply.code(403).send({
                success: false,
                error: 'Publisher account required'
            });
        }
    });
}

const authPluginExport = fp(authPlugin, {
    name: 'auth-middleware'
});

module.exports = authPluginExport;
