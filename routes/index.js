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

router.get('/about', (req, res) => {
    res.render('about', {
        title: 'About Me',
        name: 'Stephen Ezekiel C. Robles',
        description: 'I am a web systems student building projects with Node.js, Express, and EJS.'
    });
});
module.exports = router;