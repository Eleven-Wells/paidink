class EventBus {
    constructor() {
        this._handlers = {};
    }

    on(event, handler) {
        if (!this._handlers[event]) {
            this._handlers[event] = [];
        }
        this._handlers[event].push(handler);
    }

    removeHandler(event, handler) {
        const handlers = this._handlers[event];
        if (!handlers) return;
        this._handlers[event] = handlers.filter(h => h !== handler);
        if (this._handlers[event].length === 0) {
            delete this._handlers[event];
        }
    }

    clear() {
        this._handlers = {};
    }

    emit(event, payload) {
        const handlers = this._handlers[event];
        if (!handlers) return;
        handlers.forEach(handler => {
            try {
                handler(payload);
            } catch (err) {
                console.error(`EventBus: handler error for event "${event}":`, err);
            }
        });
    }
}

module.exports = EventBus;
