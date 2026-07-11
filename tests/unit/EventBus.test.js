const EventBus = require('../../src/services/ads/EventBus');

describe('EventBus', () => {
    let bus;

    beforeEach(() => {
        bus = new EventBus();
    });

    it('should emit and receive events', () => {
        const handler = jest.fn();
        bus.on('test.event', handler);
        bus.emit('test.event', { key: 'value' });
        expect(handler).toHaveBeenCalledWith({ key: 'value' });
    });

    it('should support multiple handlers per event', () => {
        const h1 = jest.fn();
        const h2 = jest.fn();
        bus.on('test.event', h1);
        bus.on('test.event', h2);
        bus.emit('test.event', {});
        expect(h1).toHaveBeenCalledTimes(1);
        expect(h2).toHaveBeenCalledTimes(1);
    });

    it('should not fail when emitting unregistered events', () => {
        expect(() => bus.emit('nonexistent', {})).not.toThrow();
    });

    it('should support removeHandler', () => {
        const handler = jest.fn();
        bus.on('test.event', handler);
        bus.removeHandler('test.event', handler);
        bus.emit('test.event', {});
        expect(handler).not.toHaveBeenCalled();
    });
});
