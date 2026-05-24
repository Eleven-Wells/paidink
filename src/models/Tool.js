const mongoose = require('mongoose');

const blogSchema = new mongoose.Schema({
    name: String,
    description: String,
    link: String,
    category: String,
    source: String,
    imageUrl: String,
    createdAt: { type: Date, default: Date.now },
}, {
    timestamps: true,
    indexes: [
        { link: 1, unique: true }
    ]
});

module.exports = mongoose.model('Blog', blogSchema);