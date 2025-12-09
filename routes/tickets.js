const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

// Ticket statuses
const TICKET_STATUSES = ['open', 'in progress', 'resolved', 'closed'];

// Show contact form (public access)
router.get('/contact', (req, res) => {
    res.render('contact', {
        title: 'Contact Us',
        user: req.session.user || null,
        success: req.query.success || null,
        error: req.query.error || null
    });
});

// Submit contact form / create ticket
router.post('/contact', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const ticketsCollection = db.collection('tickets');

        // Get user info if logged in, otherwise use form data
        const userId = req.session.user ? req.session.user.userId : null;
        const userEmail = req.session.user ? req.session.user.email : req.body.email;
        const userName = req.session.user 
            ? `${req.session.user.firstName} ${req.session.user.lastName}`
            : req.body.name;

        // Validate required fields
        if (!userName || !userEmail || !req.body.subject || !req.body.message) {
            return res.render('contact', {
                title: 'Contact Us',
                user: req.session.user || null,
                error: 'All fields are required.',
                name: req.body.name,
                email: req.body.email,
                subject: req.body.subject,
                message: req.body.message
            });
        }

        // Create ticket
        const ticket = {
            ticketId: uuidv4(),
            userId: userId,
            name: userName,
            email: userEmail,
            subject: req.body.subject,
            message: req.body.message,
            status: 'open',
            priority: req.body.priority || 'medium',
            createdAt: new Date(),
            updatedAt: new Date(),
            replies: []
        };

        await ticketsCollection.insertOne(ticket);

        res.redirect('/contact?success=Your message has been sent successfully. We will get back to you soon!');
    } catch (err) {
        console.error('Error creating ticket:', err);
        res.render('contact', {
            title: 'Contact Us',
            user: req.session.user || null,
            error: 'An error occurred. Please try again.',
            name: req.body.name,
            email: req.body.email,
            subject: req.body.subject,
            message: req.body.message
        });
    }
});

// List all tickets (admin only)
router.get('/admin/tickets', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.redirect('/users/login');
    }

    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const ticketsCollection = db.collection('tickets');

        const statusFilter = req.query.status;
        let query = {};
        if (statusFilter && TICKET_STATUSES.includes(statusFilter)) {
            query.status = statusFilter;
        }

        const tickets = await ticketsCollection.find(query).sort({ createdAt: -1 }).toArray();

        res.render('admin-tickets', {
            title: 'Support Tickets',
            user: req.session.user,
            tickets: tickets,
            statuses: TICKET_STATUSES,
            currentStatus: statusFilter || 'all'
        });
    } catch (err) {
        console.error('Error fetching tickets:', err);
        res.render('admin-tickets', {
            title: 'Support Tickets',
            user: req.session.user,
            tickets: [],
            statuses: TICKET_STATUSES,
            currentStatus: 'all',
            error: 'Error loading tickets.'
        });
    }
});

// View single ticket detail (admin or ticket owner)
router.get('/tickets/:ticketId', async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/users/login');
    }

    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const ticketsCollection = db.collection('tickets');
        const ticket = await ticketsCollection.findOne({ ticketId: req.params.ticketId });

        if (!ticket) {
            return res.status(404).send('Ticket not found');
        }

        // Allow admin or ticket owner
        if (req.session.user.role !== 'admin' && ticket.userId !== req.session.user.userId) {
            return res.status(403).send('Forbidden');
        }

        res.render('ticket-detail', {
            title: `Ticket: ${ticket.subject}`,
            user: req.session.user,
            ticket: ticket,
            statuses: TICKET_STATUSES
        });
    } catch (err) {
        console.error('Error loading ticket:', err);
        res.status(500).send('Error loading ticket');
    }
});

// Update ticket status (admin only)
router.post('/tickets/:ticketId/status', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).send('Unauthorized');
    }

    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const newStatus = req.body.status;

        if (!TICKET_STATUSES.includes(newStatus)) {
            return res.redirect(`/tickets/${req.params.ticketId}?error=Invalid status`);
        }

        await db.collection('tickets').updateOne(
            { ticketId: req.params.ticketId },
            { $set: { status: newStatus, updatedAt: new Date() } }
        );

        res.redirect(`/tickets/${req.params.ticketId}`);
    } catch (err) {
        console.error('Error updating ticket status:', err);
        res.redirect(`/tickets/${req.params.ticketId}?error=Error updating status`);
    }
});

// Update ticket priority (admin only)
router.post('/tickets/:ticketId/priority', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).send('Unauthorized');
    }

    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const newPriority = req.body.priority;
        const validPriorities = ['low', 'medium', 'high', 'urgent'];

        if (!validPriorities.includes(newPriority)) {
            return res.redirect(`/tickets/${req.params.ticketId}?error=Invalid priority`);
        }

        await db.collection('tickets').updateOne(
            { ticketId: req.params.ticketId },
            { $set: { priority: newPriority, updatedAt: new Date() } }
        );

        res.redirect(`/tickets/${req.params.ticketId}`);
    } catch (err) {
        console.error('Error updating ticket priority:', err);
        res.redirect(`/tickets/${req.params.ticketId}?error=Error updating priority`);
    }
});

// Add reply to ticket
router.post('/tickets/:ticketId/reply', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).send('Unauthorized');
    }

    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const ticketsCollection = db.collection('tickets');
        const ticket = await ticketsCollection.findOne({ ticketId: req.params.ticketId });

        if (!ticket) {
            return res.status(404).send('Ticket not found');
        }

        // Check if ticket is closed
        if (ticket.status === 'closed') {
            return res.redirect(`/tickets/${req.params.ticketId}?error=Cannot reply to a closed ticket`);
        }

        // Allow admin or ticket owner
        if (req.session.user.role !== 'admin' && ticket.userId !== req.session.user.userId) {
            return res.status(403).send('Forbidden');
        }

        const reply = {
            replyId: uuidv4(),
            userId: req.session.user.userId,
            userName: `${req.session.user.firstName} ${req.session.user.lastName}`,
            userRole: req.session.user.role,
            message: req.body.message,
            createdAt: new Date()
        };

        await ticketsCollection.updateOne(
            { ticketId: req.params.ticketId },
            { 
                $push: { replies: reply },
                $set: { updatedAt: new Date() }
            }
        );

        res.redirect(`/tickets/${req.params.ticketId}`);
    } catch (err) {
        console.error('Error adding reply:', err);
        res.redirect(`/tickets/${req.params.ticketId}?error=Error adding reply`);
    }
});

// View user's own tickets
router.get('/my-tickets', async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/users/login');
    }

    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const ticketsCollection = db.collection('tickets');
        const tickets = await ticketsCollection.find({ 
            userId: req.session.user.userId 
        }).sort({ createdAt: -1 }).toArray();

        res.render('my-tickets', {
            title: 'My Tickets',
            user: req.session.user,
            tickets: tickets
        });
    } catch (err) {
        console.error('Error fetching user tickets:', err);
        res.render('my-tickets', {
            title: 'My Tickets',
            user: req.session.user,
            tickets: [],
            error: 'Error loading tickets.'
        });
    }
});

module.exports = router;