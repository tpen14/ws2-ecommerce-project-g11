const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const saltRounds = 12;
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

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
                email: req.body.email
            });
        }

        // 2. Validate password
        const password = req.body.password;
        const confirmPassword = req.body.confirmPassword;
        
        // Check if passwords match
        if (password !== confirmPassword) {
            return res.render('register', {
                title: "Register",
                error: "Passwords do not match.",
                firstName: req.body.firstName,
                lastName: req.body.lastName,
                email: req.body.email
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
                email: req.body.email
            });
        }

        // 3. Hash password
        const hashedPassword = await bcrypt.hash(req.body.password, saltRounds);
        const currentDate = new Date();
        
        // 4. Create verification token
        const token = uuidv4();
        const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
        const verificationUrl = `${baseUrl}/users/verify/${token}`;
        
        // 5. Build new user object
        const newUser = {
            userId: uuidv4(),
            firstName: req.body.firstName,
            lastName: req.body.lastName,
            email: req.body.email,
            passwordHash: hashedPassword,
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
            subject: 'Verify your account',
            html: `
                <h2>Welcome, ${newUser.firstName}!</h2>
                <p>Thank you for registering. Please verify your email by clicking the link below:</p>
                <a href="${verificationUrl}">${verificationUrl}</a>
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
            email: req.body.email
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
router.get('/dashboard', (req, res) => {
    if (!req.session.user) return res.redirect('/users/login');
    res.render('dashboard', { title: "User Dashboard", user: req.session.user });
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
        
        await usersCollection.updateOne(
            { userId: req.params.id },
            { $set: { 
                firstName: req.body.firstName, 
                lastName: req.body.lastName,
                email: req.body.email,
                role: req.body.role,
                accountStatus: req.body.accountStatus,
                updatedAt: new Date() 
            }}
        );
        
        // If the updated user is the current logged in user, update the session
        if (req.session.user && req.session.user.userId === req.params.id) {
            req.session.user.firstName = req.body.firstName;
            req.session.user.lastName = req.body.lastName;
            req.session.user.email = req.body.email;
            req.session.user.role = req.body.role;
        }
        
        // Redirect to admin page with success message
        res.redirect('/users/admin?success=User updated successfully');
    } catch (err) {
        console.error("Error updating user:", err);
        res.render('edit-user', {
            title: "Edit User",
            user: req.body,
            error: "Something went wrong during update. Please try again."
        });
    }
});

// Delete user
router.post('/delete/:id', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const usersCollection = db.collection('users');
        
        // Make sure users can't delete themselves
        if (req.session.user && req.session.user.userId === req.params.id) {
            return res.redirect('/users/admin?error=You cannot delete your own account');
        }
        
        await usersCollection.deleteOne({ userId: req.params.id });
        
        // Redirect to admin page with success message
        res.redirect('/users/admin?success=User deleted successfully');
    } catch (err) {
        console.error("Error deleting user:", err);
        res.redirect('/users/admin?error=Failed to delete user');
    }
});

// (Admin route consolidated above)

module.exports = router;