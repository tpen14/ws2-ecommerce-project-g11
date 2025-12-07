const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const saltRounds = 12;
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);
const verifyTurnstile = require('../utils/turnstileVerify');

// Home page route
router.get('/', (req, res) => {
  res.render('index', { 
    title: 'Chonccolate - Home',
    user: req.session.user || null 
  });
});
 

// Show registration form
router.get('/register', (req, res) => {
    res.render('register', { title: "Register" });
});

// Registration (POST)
router.post('/register', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const usersCollection = db.collection('users');
        
        // 1. Check if user already exists by email
        const existingUser = await usersCollection.findOne({ email: req.body.email });
        if (existingUser) {
            return res.render('register', { 
                title: "Register", 
                error: "This email address is already registered. Please use a different email.",
                firstName: req.body.firstName,
                lastName: req.body.lastName,
                email: req.body.email,
                contactNumber: req.body.contactNumber
            });
        }

        // 2. Validate password
        const password = req.body.password;
        const confirmPassword = req.body.confirmPassword;

        // Optional contact/address (Philippines) from registration
        const contact = (req.body.contactNumber || '').trim();
        const phRegex = /^(?:\+63|0)9\d{9}$/;
        if (contact && !phRegex.test(contact)) {
            return res.render('register', {
                title: "Register",
                error: "Contact number format is invalid. Use 09XXXXXXXXX or +639XXXXXXXXX.",
                firstName: req.body.firstName,
                lastName: req.body.lastName,
                email: req.body.email,
                contactNumber: req.body.contactNumber
            });
        }

        // Build structured address object
        const addressObj = {
            region: (req.body.region || '').trim(),
            province: (req.body.province || '').trim(),
            city: (req.body.city || '').trim(),
            barangay: (req.body.barangay || '').trim(),
            street: (req.body.street || '').trim()
        };
        
        // Check if passwords match
        if (password !== confirmPassword) {
            return res.render('register', {
                title: "Register",
                error: "Passwords do not match.",
                firstName: req.body.firstName,
                lastName: req.body.lastName,
                email: req.body.email,
                contactNumber: req.body.contactNumber
            });
        }
        
        // Validate password strength
        const lengthValid = /.{8,}/.test(password);
        const uppercaseValid = /[A-Z]/.test(password);
        const lowercaseValid = /[a-z]/.test(password);
        const numberValid = /[0-9]/.test(password);
        const specialValid = /[!@#$%^&*(),.?":{}|<>]/.test(password);
        
        if (!lengthValid || !uppercaseValid || !lowercaseValid || !numberValid || !specialValid) {
            let errors = [];
            if (!lengthValid) errors.push("at least 8 characters");
            if (!uppercaseValid) errors.push("an uppercase letter");
            if (!lowercaseValid) errors.push("a lowercase letter");
            if (!numberValid) errors.push("a number");
            if (!specialValid) errors.push("a special character");
            
            return res.render('register', {
                title: "Register",
                error: `Password must contain ${errors.join(", ")}.`,
                firstName: req.body.firstName,
                lastName: req.body.lastName,
                email: req.body.email,
                contactNumber: req.body.contactNumber
            });
        }

        // 3. Hash password
        const hashedPassword = await bcrypt.hash(req.body.password, saltRounds);
        const currentDate = new Date();
        
        // 4. Create verification token
        const token = uuidv4();
        const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
        const verificationUrl = `${baseUrl}/users/verify/${token}`;
        
        // 5. Build new user object with structured address
        const newUser = {
            userId: uuidv4(),
            firstName: req.body.firstName,
            lastName: req.body.lastName,
            email: req.body.email,
            passwordHash: hashedPassword,
            contactNumber: contact || '',
            address: addressObj,
            role: 'customer',
            accountStatus: 'active',
            isEmailVerified: false,
            verificationToken: token,
            tokenExpiry: new Date(Date.now() + 3600000),
            createdAt: currentDate,
            updatedAt: currentDate
        };
        
        // 6. Insert into database
        await usersCollection.insertOne(newUser);

        // 7. Send verification email using Resend
        await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL,
            to: newUser.email,
            subject: 'Verify your Chonccolate account',
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
                                                Welcome, ${newUser.firstName}!
                                            </h2>
                                            <p style="margin: 0 0 20px 0; line-height: 1.6; font-size: 1rem; color: #F0E6D2;">
                                                Thank you for registering with Chonccolate. To complete your registration and activate your account, please verify your email address by clicking the button below.
                                            </p>
                                            

                                            <!-- Button -->
                                            <table role="presentation" style="margin: 30px 0; width: 100%;">
                                                <tr>
                                                    <td align="center">
                                                        <a href="${verificationUrl}" style="display: inline-block; padding: 15px 40px; background: linear-gradient(135deg, #C89B3C 0%, #785A28 100%); color: #010A13; text-decoration: none; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; border-radius: 4px; border: 2px solid #C89B3C; box-shadow: 0 4px 20px rgba(200, 155, 60, 0.4);">
                                                            VERIFY EMAIL
                                                        </a>
                                                    </td>
                                                </tr>
                                            </table>
                                            

                                            <p style="margin: 20px 0 0 0; line-height: 1.6; font-size: 0.9rem; color: #5B5A56;">
                                                If the button doesn't work, copy and paste this link into your browser:
                                            </p>
                                            <p style="margin: 10px 0 0 0; padding: 15px; background: rgba(10, 200, 185, 0.1); border-left: 4px solid #0BC6E3; border-radius: 4px; word-break: break-all; font-size: 0.85rem; color: #0BC6E3;">
                                                ${verificationUrl}
                                            </p>
                                            

                                            <p style="margin: 30px 0 0 0; line-height: 1.6; font-size: 0.85rem; color: #5B5A56;">
                                                This verification link will expire in 1 hour.
                                            </p>
                                        </td>
                                    </tr>
                                    
                                    <!-- Footer -->
                                    <tr>
                                        <td style="padding: 30px 40px; text-align: center; border-top: 1px solid rgba(200, 155, 60, 0.3);">
                                            <p style="margin: 0; font-size: 0.85rem; color: #5B5A56; line-height: 1.6;">
                                                If you didn't create an account with Chonccolate, please ignore this email.
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
        
        // 8. Redirect with success message
        res.redirect('/users/login?success=Registration successful! Please check your email for verification instructions.');
    } catch (err) {
        console.error("Error saving user:", err);
        res.render('register', {
            title: "Register",
            error: "An error occurred during registration. Please try again.",
            firstName: req.body.firstName,
            lastName: req.body.lastName,
            email: req.body.email,
            contactNumber: req.body.contactNumber
        });
    }
});

// Email Verification Route
router.get('/verify/:token', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const usersCollection = db.collection('users');
        
        // 1. Find user by token
        const user = await usersCollection.findOne({ verificationToken: req.params.token });
        
        // 2. Check if token exists
        if (!user) {
            return res.render('verify', { 
                success: false,
                title: "Invalid Verification Link",
                message: "This verification link is invalid or has already been used.",
                expired: false
            });
        }
        
        // 3. Check if token is still valid
        if (user.tokenExpiry < new Date()) {
            return res.render('verify', { 
                success: false,
                title: "Verification Link Expired",
                message: "This verification link has expired. Please register again.",
                expired: true
            });
        }
        
        // 4. Update user as verified
        await usersCollection.updateOne(
            { verificationToken: req.params.token },
            { 
                $set: { 
                    isEmailVerified: true,
                    accountStatus: 'active',
                    updatedAt: new Date()
                }, 
                $unset: { 
                    verificationToken: "", 
                    tokenExpiry: "" 
                } 
            }
        );
        
        res.render('verify', { 
            success: true,
            title: "Email Verified",
            message: "Your email has been successfully verified.",
            expired: false
        });
        
    } catch (err) {
        console.error("Error verifying user:", err);
        res.render('verify', { 
            success: false,
            title: "Verification Error",
            message: "Something went wrong during verification. Please try again later.",
            expired: false
        });
    }
});

// Show login form
router.get('/login', (req, res) => {
    const successMessage = req.query.success || null;
    res.render('login', { 
        title: "Login",
        success: successMessage 
    });
});

// Handle login form submission
router.post('/login', async (req, res) => {
    try {
        // --- Turnstile verification (block early to avoid doing work for bots) ---
        const turnstileToken =
            req.body['cf-turnstile-response'] ||
            req.body.turnstileToken ||
            req.body['turnstile-response'] ||
            req.body.token;

        if (!turnstileToken) {
            return res.render('login', {
                title: "Login",
                error: "Please complete the CAPTCHA verification.",
                email: req.body.email
            });
        }

        try {
            const verification = await verifyTurnstile(turnstileToken, req.ip);
            if (!verification || !verification.success) {
                console.error('Turnstile verification failed:', verification);
                let message = 'CAPTCHA verification failed. Please try again.';
                if (verification && verification['error-codes']) {
                    const codes = Array.isArray(verification['error-codes'])
                        ? verification['error-codes'].join(', ')
                        : verification['error-codes'];
                    message += ` (${codes})`;
                }
                return res.render('login', {
                    title: "Login",
                    error: message,
                    email: req.body.email
                });
            }
        } catch (verErr) {
            console.error('Error during Turnstile verification:', verErr);
            return res.render('login', {
                title: "Login",
                error: "Error verifying CAPTCHA. Please try again later.",
                email: req.body.email
            });
        }
        // --- End Turnstile check ---

        const db = req.app.locals.client.db(req.app.locals.dbName);
        const usersCollection = db.collection('users');

        // Find user by email
        const user = await usersCollection.findOne({ email: req.body.email });

        // Check if user exists
        if (!user) {
            return res.render('login', {
                title: "Login",
                error: "Email address not found. Please check your email or register.",
                email: req.body.email
            });
        }

        // Check if account is active
        if (user.accountStatus !== 'active') {
            return res.render('login', {
                title: "Login",
                error: "Your account is not active. Please contact support.",
                email: req.body.email
            });
        }

        // Check if email is verified
        if (!user.isEmailVerified) {
            return res.render('login', {
                title: "Login",
                error: "Please verify your email before logging in.",
                email: req.body.email
            });
        }

        // Compare hashed password
        const isPasswordValid = await bcrypt.compare(req.body.password, user.passwordHash);

        if (isPasswordValid) {
            // Store session
            req.session.user = {
                userId: user.userId,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                role: user.role,
                isEmailVerified: user.isEmailVerified
            };
            res.redirect('/users/dashboard');
        } else {
            // Password incorrect
            return res.render('login', {
                title: "Login",
                error: "Incorrect password. Please try again.",
                email: req.body.email
            });
        }
    } catch (err) {
        console.error("Error during login:", err);
        res.render('login', {
            title: "Login",
            error: "An error occurred during login. Please try again later.",
            email: req.body.email
        });
    }
});

// Admin page (users list)
router.get('/admin', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.redirect('/users/login');
    }
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const usersCollection = db.collection('users');
        const users = await usersCollection.find().toArray();

        res.render('admin', {
            title: 'Admin Dashboard',
            users: users,
            currentUser: req.session.user,
            success: req.query.success,
            error: req.query.error
        });
    } catch (err) {
        console.error('Error loading admin page:', err);
        res.render('admin', {
            title: 'Admin Dashboard',
            users: [],
            currentUser: req.session.user,
            error: 'Error loading admin data. Please try again.'
        });
    }
});

// Dashboard route
router.get('/dashboard', async (req, res) => {
    if (!req.session.user) return res.redirect('/users/login');
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        // Load fresh user document from DB so contactNumber/address are authoritative
        const usersCollection = db.collection('users');
        const dbUser = await usersCollection.findOne({ userId: req.session.user.userId });

        // Build a user object for the view using the DB values when available
        const viewUser = Object.assign({}, req.session.user, {
            firstName: dbUser && dbUser.firstName ? dbUser.firstName : req.session.user.firstName,
            lastName: dbUser && dbUser.lastName ? dbUser.lastName : req.session.user.lastName,
            email: dbUser && dbUser.email ? dbUser.email : req.session.user.email,
            contactNumber: dbUser && dbUser.contactNumber ? dbUser.contactNumber : (req.session.user.contactNumber || ''),
            address: dbUser && dbUser.address ? dbUser.address : (req.session.user.address || ''),
            isEmailVerified: dbUser && typeof dbUser.isEmailVerified !== 'undefined' ? dbUser.isEmailVerified : req.session.user.isEmailVerified,
            role: dbUser && dbUser.role ? dbUser.role : req.session.user.role
        });

        // Update session with any fresh fields so future requests can reuse them
        req.session.user = Object.assign({}, req.session.user, {
            contactNumber: viewUser.contactNumber,
            address: viewUser.address,
            firstName: viewUser.firstName,
            lastName: viewUser.lastName,
            email: viewUser.email,
            isEmailVerified: viewUser.isEmailVerified,
            role: viewUser.role
        });

        // Get order counts by status
        const ordersCollection = db.collection('orders');
        const statusCounts = {
            'to pay': 0,
            'to ship': 0,
            'to receive': 0,
            'completed': 0,
            'refund': 0,
            'cancelled': 0
        };

        // Build filter based on role
        let userFilter = {};
        if (req.session.user.role === 'admin') {
            // Admin sees all orders
            userFilter = {};
        } else {
            // Customer sees only their orders
            const uid = req.session.user.userId;
            userFilter = { $or: [{ userId: uid }, { userId: String(uid) }] };
        }

        // Aggregate to get counts per status
        const pipeline = [
            { $match: userFilter },
            { $group: { _id: '$orderStatus', count: { $sum: 1 } } }
        ];
        
        const results = await ordersCollection.aggregate(pipeline).toArray();
        results.forEach(item => {
            if (item._id && statusCounts.hasOwnProperty(item._id)) {
                statusCounts[item._id] = item.count;
            }
        });

        console.log(`Status breakdown for ${req.session.user.role}:`, statusCounts);

        res.render('dashboard', { 
            title: "User Dashboard", 
            user: viewUser,
            statusCounts: statusCounts
        });
    } catch (err) {
        console.error('Error loading dashboard:', err);
        res.render('dashboard', { 
            title: "User Dashboard", 
            user: req.session.user,
            statusCounts: {
                'to pay': 0,
                'to ship': 0,
                'to receive': 0,
                'completed': 0,
                'refund': 0,
                'cancelled': 0
            }
        });
    }
});

// Customer: edit own profile (GET)
router.get('/profile', async (req, res) => {
    if (!req.session.user) return res.redirect('/users/login');
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const usersCollection = db.collection('users');
        const user = await usersCollection.findOne({ userId: req.session.user.userId });
        if (!user) return res.redirect('/users/login');
        res.render('edit-profile', { title: 'Edit Profile', user, success: req.query.success, error: req.query.error });
    } catch (err) {
        console.error('Error loading profile edit:', err);
        res.render('edit-profile', { title: 'Edit Profile', user: req.session.user, error: 'Error loading profile. Please try again.' });
    }
});

// Customer: update own profile (POST)
router.post('/profile', async (req, res) => {
    if (!req.session.user) return res.redirect('/users/login');
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const usersCollection = db.collection('users');
        // Validate optional contact number (Philippines) format if provided
        const contact = (req.body.contactNumber || '').trim();
        const phRegex = /^(?:\+63|0)9\d{9}$/;
        if (contact && !phRegex.test(contact)) {
            return res.render('edit-profile', { title: 'Edit Profile', user: req.body, error: 'Contact number format is invalid. Use 09XXXXXXXXX or +639XXXXXXXXX.' });
        }

        // Build structured address object - store the selected text values
        const addressObj = {
            region: (req.body.region || '').trim(),
            province: (req.body.province || '').trim(),
            city: (req.body.city || '').trim(),
            barangay: (req.body.barangay || '').trim(),
            street: (req.body.street || '').trim()
        };

        const updates = {
            firstName: req.body.firstName,
            lastName: req.body.lastName,
            email: req.body.email,
            contactNumber: contact || '',
            address: addressObj,
            updatedAt: new Date()
        };

        // Optional password change
        if (req.body.password && req.body.password.length > 0) {
            if (req.body.password !== req.body.confirmPassword) {
                return res.render('edit-profile', { title: 'Edit Profile', user: req.body, error: 'Passwords do not match.' });
            }
            const hashed = await bcrypt.hash(req.body.password, saltRounds);
            updates.passwordHash = hashed;
        }

        await usersCollection.updateOne({ userId: req.session.user.userId }, { $set: updates });

        // Update session user values
        req.session.user.firstName = updates.firstName;
        req.session.user.lastName = updates.lastName;
        req.session.user.email = updates.email;
        req.session.user.contactNumber = updates.contactNumber;
        req.session.user.address = updates.address;

        res.redirect('/users/profile?success=Profile updated successfully');
    } catch (err) {
        console.error('Error updating profile:', err);
        res.render('edit-profile', { title: 'Edit Profile', user: req.body, error: 'Failed to update profile. Please try again.' });
    }
});

// Logout
router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/users/login');
});

// Show all registered users
router.get('/list', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const usersCollection = db.collection('users');
        const users = await usersCollection.find().toArray();
        res.render('users-list', { 
            title: "Registered Users", 
            users: users,
            success: req.query.success || null,
            error: req.query.error || null
        });
    } catch (err) {
        console.error("Error fetching users:", err);
        res.render('users-list', { 
            title: "Registered Users", 
            users: [],
            error: "Error fetching users. Please try again."
        });
    }
});

// Show edit form
router.get('/edit/:id', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const usersCollection = db.collection('users');
        const user = await usersCollection.findOne({ userId: req.params.id });
        if (!user) {
            return res.send("User not found.");
        }
        res.render('edit-user', { title: "Edit User", user: user });
    } catch (err) {
        console.error("Error loading user:", err);
        res.send("Something went wrong.");
    }
});

// Handle update form
router.post('/edit/:id', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const usersCollection = db.collection('users');
        
        // First, get the existing user to ensure we don't overwrite important fields
        const existingUser = await usersCollection.findOne({ userId: req.params.id });
        
        if (!existingUser) {
            return res.redirect('/users/admin?error=User not found');
        }
        
        // Validate that role and accountStatus are provided
        if (!req.body.role || !req.body.accountStatus) {
            return res.render('edit-user', {
                title: "Edit User",
                user: existingUser,
                error: "Role and Account Status are required."
            });
        }
        
        // Admin can only update role and accountStatus
        // All other fields (firstName, lastName, email, etc.) remain unchanged
        await usersCollection.updateOne(
            { userId: req.params.id },
            { $set: { 
                role: req.body.role,
                accountStatus: req.body.accountStatus,
                updatedAt: new Date()
            }}
        );
        
        // If the updated user is the current logged in user, update the session
        if (req.session.user && req.session.user.userId === req.params.id) {
            req.session.user.role = req.body.role;
            // If admin suspends their own account, log them out
            if (req.body.accountStatus !== 'active') {
                req.session.destroy();
                return res.redirect('/users/login?error=Your account status has been changed. Please contact support.');
            }
        }
        
        // Redirect to admin page with success message
        res.redirect('/users/admin?success=User role and status updated successfully');
    } catch (err) {
        console.error("Error updating user:", err);
        // Get user again for re-rendering the form
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const usersCollection = db.collection('users');
        const user = await usersCollection.findOne({ userId: req.params.id });
        res.render('edit-user', {
            title: "Edit User",
            user: user || req.body,
            error: "Something went wrong during update. Please try again."
        });
    }
});

// Delete user route (admin only)
router.post('/delete/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.redirect('/users/login');
    }
    
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const usersCollection = db.collection('users');
        
        // Prevent admin from deleting themselves
        if (req.params.id === req.session.user.userId) {
            return res.redirect('/users/admin?error=You cannot delete your own account');
        }
        
        // Check if user exists
        const userToDelete = await usersCollection.findOne({ userId: req.params.id });
        if (!userToDelete) {
            return res.redirect('/users/admin?error=User not found');
        }
        
        // Delete the user
        await usersCollection.deleteOne({ userId: req.params.id });
        
        res.redirect('/users/admin?success=User deleted successfully');
    } catch (err) {
        console.error('Error deleting user:', err);
        res.redirect('/users/admin?error=Failed to delete user. Please try again.');
    }
});

module.exports = router;