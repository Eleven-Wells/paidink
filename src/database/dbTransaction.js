const mongoose = require('mongoose');

let session = null;

async function withTransaction(callback, options = {}) {
    const { readConcern = 'majority', writeConcern = { w: 'majority' } } = options;

    if (mongoose.connection.readyState !== 1) {
        throw new Error('Database not connected');
    }

    const isReplicaSet = mongoose.connection.topology?.constructor.name === 'ReplSet';

    if (!isReplicaSet) {
        return callback(mongoose.connection.startSession());
    }

    const transactionOptions = {
        readConcern: { level: readConcern },
        writeConcern: { w: writeConcern },
        readPreference: 'primary'
    };

    return mongoose.connection.transaction(callback, transactionOptions);
}

async function withSession(callback) {
    if (mongoose.connection.readyState !== 1) {
        throw new Error('Database not connected');
    }

    let session;
    try {
        session = await mongoose.startSession();
        return await callback(session);
    } finally {
        if (session) {
            session.endSession();
        }
    }
}

function isTransactionSupported() {
    if (mongoose.connection.readyState !== 1) {
        return false;
    }

    const topology = mongoose.connection.topology;
    if (!topology) {
        return false;
    }

    const topologyName = topology.constructor.name;
    return topologyName === 'ReplSet' || topologyName === 'Mongos';
}

function getSession() {
    return session;
}

module.exports = {
    withTransaction,
    withSession,
    isTransactionSupported,
    getSession
};
