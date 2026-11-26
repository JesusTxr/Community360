require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: process.env.TIDB_HOST,
    port: Number(process.env.TIDB_PORT || 4000),
    user: process.env.TIDB_USER,
    password: process.env.TIDB_PASSWORD,
    database: process.env.TIDB_DATABASE,
    ssl: {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true
    },
    waitForConnections: true,
    connectionLimit: 10,
    maxIdle: 0,
    idleTimeout: 60000,
    queueLimit: 0,
    connectTimeout: 25000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
});

module.exports = pool;
