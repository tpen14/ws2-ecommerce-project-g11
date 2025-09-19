// routes/index.js
const express = require('express');
const router = express.Router();
// Home route
router.get('/', (req, res) => {
    // Pass the session user to the view
    res.render('index', { 
        title: 'Home',
        user: req.session.user || null 
    });
});
module.exports = router;