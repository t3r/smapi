var express = require('express');
var router = express.Router();
var dns = require('dns');
var http = require('http');
var Promise = require('promise');

function GetStatus(url) {
  return new Promise(function(accept,reject){

    http.get(url + '/.dirindex', function(res) {
      if( res.statusCode !== 200 ) {
        res.resume()
        return reject( 'Not found' );
      }

      res.setEncoding('utf8')
      var data = ''

      res.on('data', function(chunk) {
        data += chunk;
      })

      res.on('end', function() {
        accept({ url: url, data: data });
      })
    }).on('error', function(err) {
      return reject(err)
    })
  })
}

function ParseDirindex(txt) {
  var reply = {
  }

  txt.split('\n').forEach(function(line) {
    line = line.trim()
    if( line.length < 1 ) return;
    if( line.startsWith('#') ) return;
    token = line.split(':')

    if( token[0] === "path" ) {
      if(token.length >= 2 ) {
        reply.path = token[1]
      } else {
        reply.path = "/"
      }
      return
    }

    if( token.length <= 1 )
      return;

    if( token[0] === "version" ) {
      reply.version = token[1]
      return;
    }

    if( token[0] === "time" ) {
      reply.time = token.slice(1).join(':')
      return
    }

    if( token[0] === "d" ) {
      reply.d = reply.d || {}
      reply.d[token[1]] = token[2]
    }

  })

  return reply;
}

router.get('/status/', function(req, res, next) {
  var dnsname = "terrasync.flightgear.org";

console.log("fetch status")

  dns.resolve(dnsname, "NAPTR", function(err,addresses) {
console.log("dns resovled", err, addresses )
    if( err ) {
      console.log(err);
      res.render('error', {} );
      return;
    } 

    var prms = []
    addresses = addresses || [];
    addresses.forEach( function(address,index) {
      var separator = address.regexp.charAt(0);
      var tokens = address.regexp.split(separator);
      address.url = tokens[2];
      address.index = index;
      prms.push( GetStatus( address.url ) );
    });

console.log("looking into details")
    Promise.all( prms ).then(function(values ) {
      var ts = {
        title: "Terrasync Status",
        dns: addresses,
        domainname: dnsname,

      }
      values.forEach(function(value){
        addresses.forEach(function(addr) {
          if( addr.url === value.url )
            addr.dirindex = ParseDirindex(value.data)
        })
      })

      res.render('tsstatus', {
        title: "Terrasync Status",
        dns: addresses,
        domainname: dnsname,
      });
    })

  });

});

module.exports = router;

