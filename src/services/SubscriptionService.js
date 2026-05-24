const Subscriber = require('../models/Subscriber');
const { ValidationError, DatabaseError } = require('../errors/errors');
const { captureMessage } = require('../plugins/sentry');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class SubscriptionService {
    validateEmail(email) {
        if (!email || typeof email !== 'string') {
            throw new ValidationError('INVALID_INPUT', { field: 'email', message: 'Email is required' });
        }

        const normalized = email.toLowerCase().trim();

        if (normalized.length > 255) {
            throw new ValidationError('INVALID_INPUT', { field: 'email', message: 'Email too long (max 255 characters)' });
        }

        if (!EMAIL_REGEX.test(normalized)) {
            throw new ValidationError('INVALID_EMAIL', { value: email });
        }

        return normalized;
    }

    async subscribe(email) {
        const normalizedEmail = this.validateEmail(email);

        try {
            const existing = await Subscriber.findOne({ email: normalizedEmail }).lean();
            if (existing) {
                return {
                    success: true,
                    alreadySubscribed: true,
                    email: existing.email,
                    message: 'Already subscribed'
                };
            }

            const subscriber = new Subscriber({ email: normalizedEmail });
            await subscriber.save();

            captureMessage('New subscriber', 'info', { email: normalizedEmail });

            return {
                success: true,
                alreadySubscribed: false,
                email: subscriber.email,
                subscribedAt: subscriber.createdAt,
                message: 'Subscription successful'
            };
        } catch (error) {
            if (error.code === 11000) {
                return {
                    success: true,
                    alreadySubscribed: true,
                    email: normalizedEmail,
                    message: 'Already subscribed'
                };
            }
            throw new DatabaseError('DB_002', { originalError: error.message });
        }
    }

    async unsubscribe(email) {
        const normalizedEmail = this.validateEmail(email);

        const result = await Subscriber.deleteOne({ email: normalizedEmail });

        if (result.deletedCount === 0) {
            return {
                success: false,
                message: 'Email not found in subscription list'
            };
        }

        captureMessage('Subscriber removed', 'info', { email: normalizedEmail });

        return {
            success: true,
            message: 'Unsubscribed successfully'
        };
    }

    async getSubscriber(email) {
        const normalizedEmail = this.validateEmail(email);
        return Subscriber.findOne({ email: normalizedEmail }).lean();
    }

    async getAllSubscribers(options = {}) {
        const { page = 1, limit = 50 } = options;

        const [total, subscribers] = await Promise.all([
            Subscriber.countDocuments(),
            Subscriber.find()
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean()
        ]);

        return {
            subscribers,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    async getSubscriberCount() {
        return Subscriber.countDocuments();
    }

    async bulkSubscribe(emails) {
        if (!Array.isArray(emails) || emails.length === 0) {
            throw new ValidationError('INVALID_INPUT', { field: 'emails', message: 'Array of emails required' });
        }

        const results = {
            success: 0,
            failed: 0,
            alreadySubscribed: 0,
            errors: []
        };

        for (const email of emails) {
            try {
                const result = await this.subscribe(email);
                if (result.alreadySubscribed) {
                    results.alreadySubscribed++;
                } else {
                    results.success++;
                }
            } catch (error) {
                results.failed++;
                results.errors.push({
                    email,
                    error: error.message
                });
            }
        }

        return results;
    }
}

module.exports = new SubscriptionService();
module.exports.SubscriptionService = SubscriptionService;
