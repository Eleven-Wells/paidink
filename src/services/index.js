const postService = require('./PostService');
const contentService = require('./ContentService');
const subscriptionService = require('./SubscriptionService');
const searchService = require('./SearchService');

module.exports = {
    postService,
    contentService,
    subscriptionService,
    searchService,

    PostService: postService.constructor,
    ContentService: contentService.constructor,
    SubscriptionService: subscriptionService.constructor,
    SearchService: searchService.constructor
};
