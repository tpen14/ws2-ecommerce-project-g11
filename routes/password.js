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
                { $set: { resetPasswordToken: token, resetPasswordExpires: expiry } }
            );

            // Build reset URL
            const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
            const resetUrl = `${baseUrl}/password/reset/${token}`;

            // Send email with Resend
            await resend.emails.send({
                from: process.env.RESEND_FROM_EMAIL,
                to: user.email,
                subject: 'Password Reset Request - Chonccolate',
                html: `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    </head>
                    <body style="margin: 0; padding: 0; background: linear-gradient(135deg, #010A13 0%, #0A1428 100%); font-family: 'Segoe UI', Arial, sans-serif;">
                        <table role="presentation" style="width: 100%; border-collapse: collapse; background: linear-gradient(135deg, #010A13 0%, #0A1428 100%);">
                            <tr>
                                <td align="center" style="padding: 40px 20px;">
                                    <table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse; background: linear-gradient(135deg, rgba(30, 35, 40, 0.95) 0%, rgba(10, 20, 40, 0.95) 100%); border-radius: 12px; border: 2px solid #C89B3C; box-shadow: 0 8px 40px rgba(0, 0, 0, 0.9);">
                                        <!-- Header -->
                                        <tr>
                                            <td style="padding: 30px 40px; text-align: center; border-bottom: 2px solid #C89B3C;">
                                                <h1 style="margin: 0; color: #C89B3C; font-size: 2rem; text-transform: uppercase; letter-spacing: 3px; text-shadow: 0 0 10px rgba(200, 155, 60, 0.5);">
                                                    CHONCCOLATE
                                                </h1>
                                            </td>
                                        </tr>
                                        
                                        <!-- Content -->
                                        <tr>
                                            <td style="padding: 40px; color: #F0E6D2;">
                                                <h2 style="margin: 0 0 20px 0; color: #C89B3C; font-size: 1.5rem; text-transform: uppercase; letter-spacing: 2px;">
                                                    Password Reset Request
                                                </h2>
                                                <p style="margin: 0 0 20px 0; line-height: 1.6; font-size: 1rem; color: #F0E6D2;">
                                                    Hello ${user.firstName},
                                                </p>
                                                <p style="margin: 0 0 20px 0; line-height: 1.6; font-size: 1rem; color: #F0E6D2;">
                                                    We received a request to reset your password for your Chonccolate account. Click the button below to create a new password.
                                                </p>
                                                
                                                <!-- Button -->
                                                <table role="presentation" style="margin: 30px 0; width: 100%;">
                                                    <tr>
                                                        <td align="center">
                                                            <a href="${resetUrl}" style="display: inline-block; padding: 15px 40px; background: linear-gradient(135deg, #C89B3C 0%, #785A28 100%); color: #010A13; text-decoration: none; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; border-radius: 4px; border: 2px solid #C89B3C; box-shadow: 0 4px 20px rgba(200, 155, 60, 0.4);">
                                                                RESET PASSWORD
                                                            </a>
                                                        </td>
                                                    </tr>
                                                </table>
                                                
                                                <p style="margin: 20px 0 0 0; line-height: 1.6; font-size: 0.9rem; color: #5B5A56;">
                                                    If the button doesn't work, copy and paste this link into your browser:
                                                </p>
                                                <p style="margin: 10px 0 0 0; padding: 15px; background: rgba(10, 200, 185, 0.1); border-left: 4px solid #0BC6E3; border-radius: 4px; word-break: break-all; font-size: 0.85rem; color: #0BC6E3;">
                                                    ${resetUrl}
                                                </p>
                                                
                                                <p style="margin: 30px 0 0 0; line-height: 1.6; font-size: 0.85rem; color: #5B5A56;">
                                                    This password reset link will expire in 1 hour.
                                                </p>
                                                
                                                <p style="margin: 20px 0 0 0; padding: 15px; background: rgba(231, 72, 86, 0.1); border-left: 4px solid #E74856; border-radius: 4px; line-height: 1.6; font-size: 0.9rem; color: #F0E6D2;">
                                                    <strong style="color: #E74856;">Security Notice:</strong> If you didn't request this password reset, please ignore this email or contact support if you're concerned about your account security.
                                                </p>
                                            </td>
                                        </tr>
                                        
                                        <!-- Footer -->
                                        <tr>
                                            <td style="padding: 30px 40px; text-align: center; border-top: 1px solid rgba(200, 155, 60, 0.3);">
                                                <p style="margin: 0; font-size: 0.85rem; color: #5B5A56; line-height: 1.6;">
                                                    This is an automated message. Please do not reply to this email.
                                                </p>
                                                <p style="margin: 15px 0 0 0; font-size: 0.85rem; color: #5B5A56;">
                                                    &copy; ${new Date().getFullYear()} Chonccolate. All rights reserved.
                                                </p>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>
                        </table>
                    </body>
                    </html>
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
        
        // Find user with the token - FIXED VERSION
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const usersCollection = db.collection('users');
        
        // Debug: Check if token exists at all
        const userWithToken = await usersCollection.findOne({ 
            resetPasswordToken: token
        });
        
        console.log('Token received:', token);
        console.log('User with token found:', userWithToken ? 'Yes' : 'No');
        if (userWithToken) {
            console.log('Token expiry:', userWithToken.resetPasswordExpires);
            console.log('Current time:', new Date());
            console.log('Expiry timestamp:', userWithToken.resetPasswordExpires.getTime());
            console.log('Current timestamp:', Date.now());
            console.log('Is expired?', userWithToken.resetPasswordExpires.getTime() < Date.now());
        }
        
        // Find user with valid token
        const user = await usersCollection.findOne({ 
            resetPasswordToken: token,
            resetPasswordExpires: { $gt: new Date() }  // Changed from Date.now() to new Date()
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
        
            // Update password in DB, clear token and expiry
        await usersCollection.updateOne(
        { email: user.email },
        {
        $set: { passwordHash: hashedPassword, updatedAt: new Date() },
        $unset: { resetToken: "", resetExpiry: "" }
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