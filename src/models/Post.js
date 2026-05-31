const mongoose = require('mongoose');

const PostSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true,
        maxLength: 200
    },
    slug: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        index: true
    },
    content: {
        type: String,
        required: true
    },
    summary: {
        type: String,
        required: true,
        maxLength: 500
    },
    category: {
        type: String,
        required: true,
        enum: ['development', 'business', 'health', 'lifestyle', 'news', 'sports', 'entertainment', 'politics'],
        index: true
    },
    tags: [{
        type: String,
        lowercase: true,
        trim: true
    }],
    image: {
        type: String
    },
    author: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        index: true
    },
    isPromoted: {
        type: Boolean,
        default: false
    },
    promotedAt: {
        type: Date
    },
    imageMetadata: {
        source: { type: String },
        alt_text: { type: String },
        unsplash_id: { type: String },
        photographer: { type: String },
        unsplash_url: { type: String }
    },
    publishedAt: {
        type: Date,
        default: Date.now,
        index: true
    },
    metaDescription: {
        type: String,
        maxLength: 200
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    },
    stats: {
        views: { type: Number, default: 0 },
        reads: { type: Number, default: 0 },
        earnings: { type: Number, default: 0 }
    },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    shares: { type: Number, default: 0 },
    comments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Comment' }]
});

PostSchema.index({ publishedAt: -1 });
PostSchema.index({ category: 1, publishedAt: -1 });
PostSchema.index({ tags: 1 });
PostSchema.index({ title: 'text', summary: 'text', content: 'text' });
PostSchema.index({ author: 1, publishedAt: -1 });

PostSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    next();
});

PostSchema.pre('findOneAndUpdate', function(next) {
    this.set({ updatedAt: new Date() });
    next();
});

PostSchema.set('toJSON', {
    virtuals: true,
    transform: (doc, ret) => {
        delete ret.__v;
        return ret;
    }
});

module.exports = mongoose.model('Post', PostSchema);
