class AdProviderInterface {
    get name() {
        throw new Error('Provider must implement get name()');
    }

    async getAds(context) {
        throw new Error('Provider must implement getAds(context)');
    }

    async recordImpression(data) {
        throw new Error('Provider must implement recordImpression(data)');
    }

    async recordClick(data) {
        throw new Error('Provider must implement recordClick(data)');
    }

    async healthCheck() {
        throw new Error('Provider must implement healthCheck()');
    }
}

module.exports = AdProviderInterface;
