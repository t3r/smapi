var express = require('express');
var passport = require('passport');
var DB = require('../config/database.js');
var router = express.Router();
var jwt = require('jsonwebtoken');
var auth = require('../config/auth.js');
var nodemailer = require('nodemailer');

var transporter = nodemailer.createTransport({
  host: '',
});

/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', { title: 'FlightGear Aviation Resources' } );
});

router.get('/logout', function(req, res) {
  req.logout();
  res.redirect('/');
});

router.get('/linkauthor', /*isLoggedIn, */function(req, res, next) {
  res.render('linkauthor', { user: req.user } );
});

router.get('/linkauthor/:token', /*isLoggedIn, */function(req, res, next) {
  jwt.verify( req.params.token, auth.jwtAuth.secret, function(err,decoded) {
    if( err ) return res.status(404).send("Unknown token");

    var email = decoded.data.email;
    var id = decoded.data.a;
    var extuser_id = decoded.data.b;

    console.log("linking", email, id, extuser_id );
    DB.getAuthorByEmail( email, function(err,user) {
      if(err) return res.status(500).send("Database Error");
      if( !user ) return res.status(404).send("Unknown user");
      DB.SetAuthorForExternalUser(id,extuser_id,user.au_id, function(err) {
        if(err) return res.status(500).send("Database Error: can't link");
        return res.redirect('/login');
      }); 
    });
  });
});

router.get('/linkauthor/checkmail/:email', function(req, res, next) 
{
//  if(!req.isAuthenticated()) return res.json({});

  DB.getAuthorByEmail( req.params.email, function(err,data) {
    if(err) return res.status(500).send("Database Error");
    if( !data ) return res.json({});
    return res.json({
      'name': data.au_name || '',
      'email': data.au_email || '',
      'notes': data.au_notes || '',
    });
  });
});

router.post('/linkauthor', /*isLoggedIn, */function(req, res, next) 
{
  var re = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
  if( ! re.test(req.body.email) )
    return res.render('linkauthor', { user: req.user, data: req.body } );

  DB.getOrCreateAuthorByEmail( {
    'email': req.body.email, 
    'name': req.body.name,
    'notes': req.body.notes,
  }, function(err,author) {
    if(err) return res.status(500).send("Database Error");
    var token = jwt.sign({
      data: {
        'email': author.au_email, 
        'a': req.user.authority.id, 
        'b': req.user.authority.user_id 
      },
    }, auth.jwtAuth.secret, { expiresIn: '1d', issuer: 'http://scenery.flightgear.org/', subject: 'linkauthor' } );

    var LinkUrl = "http://caravan:3001/linkauthor/" + token;
    console.log("veryfy Link is ", LinkUrl );
    transporter.sendMail({
      from: '"FlightGear Scenery Database"<no-reply@flightgear.org>',
      to: req.body.email,
      subject: 'FlightGear Scenery Database - email verification',
      text: 'Please verify your email address by following this link: ' + LinkUrl,
    }, function(err,info) {
      if (err) console.log("Error sending confirmation email", err );
      else console.log("Sent confirmation email", info );
    });
    return res.redirect('/');
  });
});


router.get('/mypage', isLoggedIn, function(req, res, next) {
console.log(req.user);
  res.render('mypage', { user: req.user } );
});

router.get('/:page', function(req, res, next) {
  res.render(req.params.page, { title: 'FlightGear Aviation Resources', user: req.user } );
});

function login(req,res,next)
{
  var authargs = {};
  if( req.params.method == 'google' ) { 
    authargs.scope = ['profile', 'email'];
  }

  if( req.user ) {
console.log("authenticate ", req.params.method, req.user, req.account );
    passport.authenticate(req.params.method,authargs)(req,res,next);
  } else {
console.log("authorize unknown user", req.params.method );
    passport.authorize(req.params.method,authargs)(req,res,next);
  }
}

function loginCallback(req,res,next)
{
  passport.authenticate(req.params.method, function(err,user,info) {
    if( err ) return next(err);
    if( !user ) return res.redirect('/login');
    req.logIn(user, function(err) {
      if (err) { return next(err); }
      if( null == user.author.id ) return res.redirect('/linkauthor');
      return res.redirect('/mypage');
    });
  })(req, res, next);
}

/*router.get('/auth/sourceforge', passport.authenticate('oauth') );
router.get('/auth/sourceforge/callback', passport.authenticate('oauth', { 
  failureRedirect: '/login' }),
  function(req, res) {
console.log("yay");
    // Successful authentication, redirect home.
    res.redirect('/');
});
*/

router.get('/auth/:method', login );

// the callback after google has authenticated the user
router.get('/auth/:method/callback', loginCallback );

function isLoggedIn(req, res, next) {

    // if user is authenticated in the session, carry on 
    if (req.isAuthenticated())
        return next();

    // if they aren't redirect them to the home page
    res.redirect('/');
}

module.exports = router;

