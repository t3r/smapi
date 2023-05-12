const GoogleStrategy = require('passport-google-oauth').OAuth2Strategy;
const GitHubStrategy = require('passport-github2').Strategy;
const JwtStrategy = require('passport-jwt').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy;

const Query = require('../pg')

class User {
  constructor() {
    this.id = -1
    this.name = ""
    this.email = ""
    this.notes = ""
    this.lastLogin = null
  }

  static SYSTEM_GITHUB = 1
  static SYSTEM_GOOGLE = 2
  static SYSTEM_FACEBOOK = 3
  static SYSTEM_TWITTER = 4

  static find = function( authorityId, id ) {
    return new Promise((resolve,reject)=> {
console.log("reading user",authorityId,id)
      Query({
        name: 'Select UserByExternalAuthority',
        text: "SELECT au_id,au_name,au_email,au_notes,au_modeldir FROM fgs_authors,fgs_extuserids \
               WHERE au_id=eu_author_id \
               AND eu_authority=$1 AND eu_external_id=$2",
        values: [ authorityId, id ]
      }, function(err, result) {
        if(err) return reject(err)
        console.log(result.rows)
        if( ! result.rows.length ) return resolve(null)
        let u = new User()
        u.id = result.rows[0].au_id
        u.name = result.rows[0].au_name
        u.email = result.rows[0].au_email
        u.notes = result.rows[0].au_notes
        console.log("last login",result.rows[0].eu_lastlogin)
        u.lastLogin = new Date() // fixme, get
        resolve(u)
      });
    })
  }
}

const StrategyConf = {
  'facebook' : {
    'clientID' : '123',
    'clientSecret' : 'secret',
    'callbackURL' : 'auth/facebook/callback',
  },

  'twitter' : {
    'consumerKey' : '123',
    'consumerSecret' : 'secret',
    'callbackURL' : 'auth/twitter/callback',
  },

  'github' : {
    'clientID' : '123',
    'clientSecret' : 'secret',
    'callbackURL' : 'auth/github/callback',
  },

  'google' : {
    'clientID' : '123',
    'clientSecret' : 'secret',
    'callbackURL' : 'auth/google/callback',
  },
}

// READ OAUTH settings from ENV
for( k in StrategyConf ) {
  const conf = process.env["OAUTH_" + k]
  if( !conf ) continue
  try {
    StrategyConf[k] = JSON.parse( conf )
  }
  catch {
    console.error("can't parse OAUTH config",conf)
  }
}

module.exports = function(passport) {

  function getCallbackUrl(suffix) {
    var urlPrefix = 'http://localhost:3001/';
    if( process.env.node_env !== 'development' ) {
      urlPrefix = process.env.urlprefix;
      if( !urlPrefix ) {
        console.log("urlprefix environment not set!")
        urlPrefix = "";
      }
    }
    urlPrefix = urlPrefix.replace(/\/+$/, "")
    return urlPrefix + "/" + suffix.replace(/^\/+/, "")
  }

  passport.serializeUser(function(user, done) {
    done(null, JSON.stringify({a:User.SYSTEM_GITHUB, b:user.authorityId}));
  });

  passport.deserializeUser(function(u, done) {
    let ud = null
    try {
      ud = JSON.parse(u)
    }
    catch( ex ) {
      const msg = "can't deserialize user"
      console.err( msg, ex )
      done( msg )
    }
    User.find( ud.a, ud.b )
    .then( user => {
      done(null,user)
    })
    .catch( err => {
      done(err)
    })
  });

  passport.use(new GoogleStrategy({

    clientID : StrategyConf.google.clientID,
    clientSecret : StrategyConf.google.clientSecret,
    callbackURL : getCallbackUrl(StrategyConf.google.callbackURL),
    passReqToCallback : true

  }, function(req, token, refreshToken, profile, done) {

    console.log("github callback with user", req.user, "profile", profile)
    User.find( User.SYSTEM_GOOGLE, req.user ? req.user.authorityId : profile.id )
    .then( user => {
      console.log("found user", user)
      if (!user)
        return done(null, null)
      return done(null, user)
    })
    .catch( err => {
        console.error(err)
        return done(null, null)
    })
/*
      user.google.id = profile.id
      user.google.token = profile.token
      user.google.name = profile.displayName
      user.name = user.name || user.google.name
      user.google.email = profile.emails[0].value
      user.google.imgUrl = profile.photos[0].value
      user.save(function(err) {
        if (err)
          throw err;
        return done(null, user)
      })
*/

  }));

  passport.use(new GitHubStrategy({

    clientID : StrategyConf.github.clientID,
    clientSecret : StrategyConf.github.clientSecret,
    callbackURL : getCallbackUrl(StrategyConf.github.callbackURL),
    passReqToCallback : true
  }, function(req, token, refreshToken, profile, done) {
    console.log("github callback with user", req.user, "profile", profile)
    User.find( User.SYSTEM_GITHUB, req.user ? req.user.authorityId : profile.id )
    .then( user => {
      console.log("found user", user)
      if (!user)
        return done(null, null)
      return done(null, user)
    })
    .catch( err => {
        console.error(err)
        return done(null, null)
    })
  }));

  passport.use(new FacebookStrategy({

    clientID : StrategyConf.facebook.clientID,
    clientSecret : StrategyConf.facebook.clientSecret,
    callbackURL : getCallbackUrl(StrategyConf.facebook.callbackURL),
    passReqToCallback : true
  }, function(req, token, refreshToken, profile, done) {
    console.log("facebook callback with user", req.user, "profile", profile)

    var filter = req.user ? {
      _id : req.user._id
    } : {
      'facebook.id' : profile.id
    }

    User.findOne(filter, function(err, user) {
      if (err)
        return done(err);

      console.log("found user", user)
      if (!user)
        return done(null, null)

      user.facebook.id = profile.id
//      user.facebook.token = profile.token
      user.facebook.name = profile.displayName
      user.name = user.name || user.facebook.name
//      user.facebook.imgUrl = profile._json.avatar_url
      user.save(function(err) {
        if (err)
          throw err;
        return done(null, user)
      })
    })
  }));

/*
  passport.use(new JwtStrategy({
    jwtFromRequest : function(req) {
      var token = null;
      if (req && req.params) {
        token = req.params.token
      }
      console.log("extracted token", token)
      return token;
    },
    secretOrKey : StrategyConf.jwtAuth.secret,
  }, function(jwt_payload, done) {
    console.log("JwtStrategy has payload", jwt_payload)
    User.findById(jwt_payload.data.key, function(err, user) {
      if( err ) throw err;
      return done(null, user)
    })
  }));
*/

};
