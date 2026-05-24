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
        await mongoose.connect(process.env.MONGO_URI, {
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
        });
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
