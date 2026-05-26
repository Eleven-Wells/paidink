const postService = require('./PostService');
const contentService = require('./ContentService');
const subscriptionService = require('./SubscriptionService');
const searchService = require('./SearchService');
const interestProfileService = require('./InterestProfileService');

module.exports = {
    postService,
    contentService,
    subscriptionService,
    searchService,
    interestProfileService,

    PostService: postService.constructor,
    ContentService: contentService.constructor,
    SubscriptionService: subscriptionService.constructor,
    SearchService: searchService.constructor,
    InterestProfileService: interestProfileService.constructor
};
