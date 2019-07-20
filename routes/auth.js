'use strict'

const jwt = require('jsonwebtoken')

module.exports = function(passport) {
  const router = require('express').Router()

  router.get('/:provider', function(req,res,next) {
    const args = {
        twitter: {
          scope : [ 'profile', 'email' ]
        },
        google: {
          scope : [ 'profile', 'email' ]
        },
        facebook: {
          scope : 'email'
        },
        github: {
        }
    }[req.params.provider]
    if( !args ) return res.status(404).send('Unknown provider');

    passport.authenticate(req.params.provider, args)(req,res,next);
  })

  router.get('/:provider/callback', function(req,res,next) {
    passport.authenticate(req.params.provider, { session: false}, function(err,user,info){
      if( err ) {
        console.log("Passport.authenticate() error", err )
        return res.status(500).send('Sorry - there was an error when processing this request')
      }
      if( !user ) return res.redirect('/linkaccount')

      let token = jwt.sign(user.id, process.env.JWT_SECRET );
      res.cookie( 'Authorization', 'Bearer ' + token, {
        maxAge: 1000 * 60 * 15, // would expire after 15 minutes
        httpOnly: false, // The cookie only accessible by the web server
        signed: false // Indicates if the cookie should be signed
      })
      res.redirect('/')

    })(req,res,next);
  })

  return router;
}
