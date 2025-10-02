const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

const bcrypt = require('bcrypt');
const saltRounds = 12;

// Show forgot password form
router.get('/forgot', (req, res) => {
    res.render('forgot-password', { title: "Forgot Password" });
});

// Handle forgot password form submission
router.post('/forgot', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const usersCollection = db.collection('users');

        // Find user by email
        const user = await usersCollection.findOne({ email: req.body.email });
        
        // Even if user doesn't exist, don't reveal that for security reasons
        // Instead, show the same message regardless
        
        if (user) {
            // Generate reset token and expiry (1 hour)
            const token = uuidv4();
            const expiry = new Date(Date.now() + 3600000);

            // Save token in database
            await usersCollection.updateOne(
                { email: user.email },
                { $set: { resetToken: token, resetExpiry: expiry } }
            );

            // Build reset URL
            const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
            const resetUrl = `${baseUrl}/password/reset/${token}`;

            // Send email with Resend
            await resend.emails.send({
                from: process.env.RESEND_FROM_EMAIL,
                to: user.email,
                subject: 'Password Reset Request',
                html: `
                    <h2>Password Reset</h2>
                    <p>Click below to reset your password:</p>
                    <a href="${resetUrl}">${resetUrl}</a>
                `
            });
        }
        
        // Always show success message regardless of whether email exists
        // This prevents revealing which emails are registered
        res.render('forgot-password', { 
            title: "Forgot Password", 
            success: "If an account with that email exists, a reset link has been sent."
        });
        
    } catch (err) {
        console.error("Error in password reset:", err);
        res.render('forgot-password', { 
            title: "Forgot Password", 
            error: "Something went wrong. Please try again later.",
            email: req.body.email
        });
    }
});

// Show reset password form
router.get('/reset/:token', (req, res) => {
    res.render('reset-password', { title: "Reset Password", token: req.params.token });
});

// Handle reset password form
router.post('/reset/:token', async (req, res) => {
    try {
        const { password, confirm } = req.body;
        const token = req.params.token;
        
        // Check if passwords match
        if (password !== confirm) {
            return res.render('reset-password', {
                title: 'Reset Password',
                token: token,
                error: 'Passwords do not match'
            });
        }
        
        // Password policy validation
        const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>])[A-Za-z\d!@#$%^&*(),.?":{}|<>]{8,}$/;
        if (!passwordRegex.test(password)) {
            return res.render('reset-password', {
                title: 'Reset Password',
                token: token,
                error: 'Password does not meet the security requirements'
            });
        }
        
        // Find user with the token
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const usersCollection = db.collection('users');
        const user = await usersCollection.findOne({ 
            resetPasswordToken: token,
            resetPasswordExpires: { $gt: Date.now() }
        });
        
        if (!user) {
            return res.render('reset-password', {
                title: 'Reset Password',
                token: token,
                error: 'Password reset token is invalid or has expired'
            });
        }
        
        // Hash the new password
        const hashedPassword = await bcrypt.hash(password, 12);
        
        // Update the user's password and clear token fields
        await usersCollection.updateOne(
            { userId: user.userId },
            { 
                $set: { 
                    password: hashedPassword,
                    updatedAt: new Date()
                },
                $unset: {
                    resetPasswordToken: "",
                    resetPasswordExpires: ""
                }
            }
        );
        
        // Redirect to login with success message
        res.redirect('/users/login?success=Your password has been changed successfully. You can now log in with your new password.');
        
    } catch (err) {
        console.error("Password reset error:", err);
        res.render('reset-password', {
            title: 'Reset Password',
            token: req.params.token,
            error: 'An error occurred while resetting your password'
        });
    }
});
module.exports = router;