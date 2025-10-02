// server.js
const express = require('express');
const bodyParser = require('body-parser');
const { MongoClient } = require('mongodb');
const session = require('express-session'); // Added for user sessions
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.use(express.static('public'));

// near the top of server.js, after session middleware
app.use((req, res, next) => {
res.locals.user = req.session?.user || null
next()
})

// Session setup
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret', // keep secret in .env
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // set true in production with HTTPS
}));

// Make user session data available to all views
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});


// Routes
const indexRoute = require('./routes/index');
const usersRoute = require('./routes/users');
const passwordRoute = require('./routes/password');
const productsRoute = require('./routes/products');

app.use('/', indexRoute);
app.use('/users', usersRoute);
app.use('/password', passwordRoute);
app.use('/products', productsRoute);

// 404 handler (must be the last route)
app.use((req, res, next) => {
res.status(404).render('404', { title: "Page Not Found" });
});

// Error handler (after the 404 is fine; Express will skip 404 forthrown errors)
app.use((err, req, res, next) => {
console.error(err)
res.status(500).render('500', { title: 'Server Error' })
})

// MongoDB Setup
const uri = process.env.MONGO_URI;
const client = new MongoClient(uri);

// Expose client & dbName to routes
app.locals.client = client;
app.locals.dbName = process.env.DB_NAME || "ecommerceDB";

async function main() {
    try {
        await client.connect();
        console.log("Connected to MongoDB Atlas");
        // Start server
        app.listen(PORT, () => {
          console.log(`Server running on port ${PORT}`);
        });
    } catch (err) {
        console.error("MongoDB connection failed", err);
    }
}

main();
