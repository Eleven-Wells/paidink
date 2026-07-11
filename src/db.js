const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

let isConnected = false;

async function connectDB() {
    if (!process.env.MONGO_URI) {
        console.log('Please add in the bd uri in the enviroment variable');
        return false;
    }

    try {
        // Some mongoose versions validate option names passed via setters.
        // To avoid "is not a valid option to set" errors in serverless
        // environments, append driver options to the connection URI instead
        // of passing them to mongoose.connect as top-level setters.
        let mongoUri = process.env.MONGO_URI;
        const params = 'serverSelectionTimeoutMS=5000&socketTimeoutMS=45000&maxPoolSize=5';

        if (!mongoUri.includes('?')) {
            mongoUri = `${mongoUri}?${params}`;
        } else {
            // Avoid duplicating params if they're already present
            if (!mongoUri.includes('serverSelectionTimeoutMS') && !mongoUri.includes('socketTimeoutMS')) {
                mongoUri = `${mongoUri}&${params}`;
            }
        }

        await mongoose.connect(mongoUri, {});
        isConnected = true;
        console.log('Connected to MongoDB');

        mongoose.connection.on('error', (err) => {
            console.error('MongoDB connection error:', err);
            isConnected = false;
        });

        mongoose.connection.on('disconnected', () => {
            console.warn('MongoDB disconnected');
            isConnected = false;
        });

        return true;
    } catch (err) {
        console.error('MongoDB error:', err);
        isConnected = false;
        throw err;
    }
}

function getConnection() {
    return mongoose.connection;
}

function isConnectedToDB() {
    return mongoose.connection.readyState === 1 && isConnected;
}

async function closeDB() {
    if (mongoose.connection.readyState !== 0) {
        await mongoose.connection.close();
        isConnected = false;
        console.log('MongoDB connection closed');
    }
}

module.exports = {
    connectDB,
    getConnection,
    isConnectedToDB,
    closeDB,
    mongoose
};
