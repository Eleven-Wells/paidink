const postService = require('./PostService');
const contentService = require('./ContentService');
const subscriptionService = require('./SubscriptionService');
const searchService = require('./SearchService');
const interestProfileService = require('./InterestProfileService');
const coreadService = require('./CoreadService');
const recommendationService = require('./RecommendationService');

module.exports = {
    postService,
    contentService,
    subscriptionService,
    searchService,
    interestProfileService,
    coreadService,
    recommendationService,

    PostService: postService.constructor,
    ContentService: contentService.constructor,
    SubscriptionService: subscriptionService.constructor,
    SearchService: searchService.constructor,
    InterestProfileService: interestProfileService.constructor,
    CoreadService: coreadService.constructor,
    RecommendationService: recommendationService.constructor
};
