const EventEmitter = require('events');

class NotificationEmitter extends EventEmitter {
    emitNotification(userId, notification) {
        this.emit(`notif:${userId}`, notification);
    }

    onNotification(userId, handler) {
        this.on(`notif:${userId}`, handler);
    }

    removeNotificationListener(userId, handler) {
        this.off(`notif:${userId}`, handler);
    }
}

module.exports = new NotificationEmitter();
