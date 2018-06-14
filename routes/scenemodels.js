var express = require('express');
var pg = require('pg');
var tar = require('tar');
var streamBuffers = require('stream-buffers');

var router = express.Router();

var client = new pg.Client();

if (!String.format) {
  String.format = function(format) {
    var args = Array.prototype.slice.call(arguments, 1);
    return format.replace(/{(\d+)}/g, function(match, number) { 
      return typeof args[number] != 'undefined'
        ? args[number] 
        : match
      ;
    });
  };
}

function toNumber(x) {
  var n = Number(x||0);
  return isNaN(n) ? 0 : n;
}

var selectSignsWithinSql = 
   "SELECT si_id, ST_Y(wkb_geometry) AS ob_lat, ST_X(wkb_geometry) AS ob_lon, \
           si_heading, si_gndelev, si_definition \
           FROM fgs_signs \
           WHERE ST_Within(wkb_geometry, ST_GeomFromText($1,4326)) \
           LIMIT 400";

var selectNavaidsWithinSql = 
   "SELECT na_id, ST_Y(na_position) AS na_lat, ST_X(na_position) AS na_lon, \
           na_type, na_elevation, na_frequency, na_range, na_multiuse, na_ident, na_name, na_airport_id, na_runway \
           FROM fgs_navaids \
           WHERE ST_Within(na_position, ST_GeomFromText($1,4326)) \
           LIMIT 400";

var pool = new pg.Pool({
//  user: 'webuser', //env var: PGUSER 
//  database: 'scenemodels', //env var: PGDATABASE 
//  password: 'secret', //env var: PGPASSWORD 
//  port: 5432, //env var: PGPORT 
  max: 10, // max number of clients in the pool 
  idleTimeoutMillis: 30000, // how long a client is allowed to remain idle before being closed 
});

pool.on('error', function (err, client) {
  // if an error is encountered by a client while it sits idle in the pool 
  // the pool itself will emit an error event with both the error and 
  // the client which emitted the original error 
  // this is a rare occurrence but can happen if there is a network partition 
  // between your application and the database, the database restarts, etc. 
  // and so you might want to handle it and at least log it out 
  console.error('WARNING: idle client received error', err.messag )
})

function Query(options,cb) {

  pool.connect(function(err, client, done) {

    if(err) {
      console.error('error fetching client from pool', err);
      return cb(err);
    }

    client.query(options, function(err, result) {
      //call `done()` to release the client back to the pool 
      done();
 
      if(err) {
        console.error('error running query', err);
        return cb(err);
      }

      return cb(null,result);

    });
  });
}

function toFeatureCollection(rows)
{
  var reply = { 
        'type': 'FeatureCollection', 
        'features': []
  }

  if( rows && Array.isArray(rows) ) rows.forEach(function(row) {
      reply.features.push({
        'type': 'Feature',
        'id': row['ob_id'],
        'geometry':{
          'type': 'Point','coordinates': [row['ob_lon'], row['ob_lat']]
        },
        'properties': {
          'id': row['ob_id'],
          'heading': row['ob_heading'],
          'title': row['ob_text'],
          'gndelev': row['ob_gndelev'],
          'elevoffset': row['ob_elevoffset'],
          'model_id': row['ob_model'],
          'model_name': row['mo_name'],
          'shared': row['mo_shared'],
          'stg': row['obpath'] + row['ob_tile'] + '.stg',
          'country': row['ob_country'],
        }
      });
  })
  return reply;
}
 
router.get('/objects/:limit/:offset?', function(req, res, next) {
  var offset = Number(req.params.offset || 0);
  var limit = Number(req.params.limit||100);

  if( isNaN(offset) || isNaN(limit) ) {
      return res.status(500).send("Invalid Request");
  }

  Query({
      name: 'Select Objects',
      text: "SELECT ob_id, ob_text, ob_country, ob_model, ST_Y(wkb_geometry) AS ob_lat, ST_X(wkb_geometry) AS ob_lon, \
           ob_heading, ob_gndelev, ob_elevoffset, mo_shared, mo_name, \
           concat('Objects/', fn_SceneDir(wkb_geometry), '/', fn_SceneSubDir(wkb_geometry), '/') AS obpath, ob_tile \
           FROM fgs_objects, fgs_models WHERE fgs_models.mo_id = fgs_objects.ob_model order by ob_modified desc limit $1 offset $2",
      values: [ limit,offset ]
    }, function(err, result) {
 
    if(err) {
      return res.status(500).send("Database Error");
    }
    return res.json(toFeatureCollection(result.rows))
  });

})

router.get('/objects/', function(req, res, next) {

  var east = toNumber(req.query.e);
  var west = toNumber(req.query.w);
  var north = toNumber(req.query.n);
  var south = toNumber(req.query.s);

  Query({
      name: 'Select Objects Within',
      text: "SELECT ob_id, ob_text, ob_country, ob_model, ST_Y(wkb_geometry) AS ob_lat, ST_X(wkb_geometry) AS ob_lon, \
           ob_heading, ob_gndelev, ob_elevoffset, mo_shared, mo_name, \
           concat('Objects/', fn_SceneDir(wkb_geometry), '/', fn_SceneSubDir(wkb_geometry), '/') AS obpath, ob_tile \
           FROM fgs_objects, fgs_models \
           WHERE ST_Within(wkb_geometry, ST_GeomFromText($1,4326)) \
           AND fgs_models.mo_id = fgs_objects.ob_model \
           LIMIT 400",
      values: [ String.format('POLYGON(({0} {1},{2} {3},{4} {5},{6} {7},{0} {1}))',west,south,west,north,east,north,east,south) ]
    }, function(err, result) {
 
    if(err) {
      return res.status(500).send("Database Error");
    }

    return res.json(toFeatureCollection(result.rows))
  })
});

router.get('/signs/', function(req, res, next) {

  var east = toNumber(req.query.e);
  var west = toNumber(req.query.w);
  var north = toNumber(req.query.n);
  var south = toNumber(req.query.s);

  Query({
      name: 'Select Signs Within',
      text: selectSignsWithinSql, 
      values: [ String.format('POLYGON(({0} {1},{2} {3},{4} {5},{6} {7},{0} {1}))',west,south,west,north,east,north,east,south) ]
    }, function(err, result) {
 
    if(err) {
      return res.status(500).send("Database Error");
    }

    var features = [];
    if( result.rows ) result.rows.forEach(function(row) {
      features.push({
        'type': 'Feature',
        'id': row['si_id'],
        'geometry':{
          'type': 'Point','coordinates': [row['ob_lon'], row['ob_lat']]
        },
        'properties': {
          'id': row['si_id'],
          'heading': row['si_heading'],
          'definition': row['si_definition'],
          'gndelev': row['si_gndelev'],
        }
      });
    });

    res.json({ 
      'type': 'FeatureCollection', 
      'features': features
    });
  });
});

router.get('/navaids/within/', function(req, res, next) {

  var east = toNumber(req.query.e);
  var west = toNumber(req.query.w);
  var north = toNumber(req.query.n);
  var south = toNumber(req.query.s);

  Query({
      name: 'Select Navaids Within',
      text: selectNavaidsWithinSql, 
      values: [ String.format('POLYGON(({0} {1},{2} {3},{4} {5},{6} {7},{0} {1}))',west,south,west,north,east,north,east,south) ]
    }, function(err, result) {
 
    if(err) {
      return res.status(500).send("Database Error");
    }

    var features = [];
    if( result.rows ) result.rows.forEach(function(row) {
      features.push({
        'type': 'Feature',
        'id': row['si_id'],
        'geometry':{
          'type': 'Point','coordinates': [row['na_lon'], row['na_lat']]
        },
        'properties': {
          'id': row['na_id'],
          'type': row['na_type'],
          'elevation': row['na_elevation'],
          'frequency': row['na_frequency'],
          'range': row['na_range'],
          'multiuse': row['na_multiuse'],
          'ident': row['na_ident'],
          'name': row['na_name'],
          'airport': row['na_airport_id'],
          'runway': row['na_runway'],
        }
      });
    });

    res.json({ 
      'type': 'FeatureCollection', 
      'features': features
    });
  });
});

router.get('/stats/', function(req, res, next) {

  Query({
      name: 'Statistics ',
      text: "with t1 as (select count(*) objects from fgs_objects), t2 as (select count(*) models from fgs_models), t3 as (select count(*) authors from fgs_authors), t4 as (select count(*) navaids from fgs_navaids), t5 as (select count(*) pends from fgs_position_requests) select objects, models, authors, navaids, pends from t1, t2, t3, t4, t5",
      values: []
    }, function(err, result) {
 
    if(err) {
      return res.status(500).send("Database Error");
    }

    var row = result.rows.length ? result.rows[0] : {};

    res.json({ 
      'stats': {
        'objects': row.objects || 0,
        'models':  row.models || 0,
        'authors': row.authors || 0,
        'navaids': row.navaids || 0,
        'pending': row.pends || 0,
      }
    });
  });
});

router.get('/stats/all', function(req, res, next) {

  Query({
      name: 'StatisticsAll',
      text: 'SELECT * from fgs_statistics ORDER BY st_date',
      values: []
  }, function(err, result) {
 
    if(err) return res.status(500).send("Database Error");
    var reply = { statistics: [] };
    result.rows.forEach( function(row) {
      reply.statistics.push( {
        'date' : row.st_date,
        'objects': row.st_objects,
        'models':  row.st_models,
        'authors': row.st_authors,
        'signs': row.st_signs,
        'navaids': row.st_navaids,
      });
    });
    res.json(reply);
  });
});

router.get('/stats/models/byauthor/:limit?/:offset?/:days?', function(req, res, next) {

  var offset = Number(req.params.offset || 0);
  var limit = Number(req.params.limit||100);
  var days =  Number(req.params.days||0);

  var QueryArgs = req.params.days ? 
  {
      name: 'StatisticsModelsByAuthorAndRange',
      text: "SELECT COUNT(mo_id) AS count, au_name,au_id FROM fgs_models, fgs_authors WHERE mo_author = au_id and mo_modified > now()::date - interval '90 days' GROUP BY au_id ORDER BY count DESC limit $1 offset $2 ",
      values: [limit, offset]
  }: {
      name: 'StatisticsModelsByAuthor',
      text: "SELECT COUNT(mo_id) AS count, au_name,au_id FROM fgs_models, fgs_authors WHERE mo_author = au_id GROUP BY au_id ORDER BY count DESC limit $1 offset $2 ",
      values: [limit, offset]
  }

  Query(QueryArgs, function(err, result) {
    if(err) return res.status(500).send("Database Error");
    var reply = { modelsbyauthor: [] };
    result.rows.forEach( function(row) {
      reply.modelsbyauthor.push( {
        'author' : row.au_name.trim(),
        'author_id' : Number(row.au_id),
        'count': Number(row.count),
      });
    });
    res.json(reply);
  });
});

router.get('/stats/models/bycountry', function(req, res, next) {

  Query({
      name: 'StatisticsModelsByCountry',
      text: 'SELECT COUNT(ob_id) AS count, COUNT(ob_id)/(SELECT shape_sqm/10000000000 FROM gadm2_meta WHERE iso ILIKE co_three) AS density, co_name, co_three FROM fgs_objects, fgs_countries WHERE ob_country = co_code AND co_three IS NOT NULL GROUP BY co_code HAVING COUNT(ob_id)/(SELECT shape_sqm FROM gadm2_meta WHERE iso ILIKE co_three) > 0 ORDER BY count DESC',
      values: []
  }, function(err, result) {
    if(err) return res.status(500).send("Database Error");
    var reply = { modelsbycountry: [] };

    result.rows.forEach( function(row) {
      reply.modelsbycountry.push( {
        'name' : row.co_name.trim(),
        'id' : row.co_three.trim(),
        'density': Number(row.density),
        'count': Number(row.count),
      });
    });
    res.json(reply);
  });
});

router.get('/modelgroups/:id?', function(req, res, next) {
  if( typeof(req.params.id) === 'undefined' ) {
    Query({
      name: 'ModelgroupList',
      text: "select mg_id, mg_name, mg_path from fgs_modelgroups order by mg_id",
      values: []
    }, function(err, result) {
      if(err) return res.status(500).send("Database Error");
      var reply = []

      result.rows.forEach(function(row) {
        reply.push({
          'id': Number(row.mg_id),
          'name': row.mg_name,
          'path': row.mg_path,
        })
      })

      res.json(reply)
    });
  } else {
    req.status(404).send('not implemented')
  }
})

router.get('/author/:id', function(req, res, next) {
  var id = toNumber( req.params.id )

  Query({
      name: 'AuthorBYId',
      text: "select au_id, au_name, au_notes,count(mo_id) as count from fgs_authors,fgs_models where au_id=mo_author and au_id = $1 group by au_id ",
      values: [id]
  }, function(err, result) {
    if(err) return res.status(500).send("Database Error");
    if( 0 == result.rows.length ) return res.status(404).send("model not found");

    var row = result.rows[0]
    res.json({
        'id': row.au_id,
        'name': row.au_name,
        'notes': row.au_notes,
        'models': row.count,

    });
  });
});

router.get('/authors/list/:limit/:offset?', function(req, res, next) {
  var offset = Number(req.params.offset || 0);
  var limit = Number(req.params.limit||0);

  if( isNaN(offset) || isNaN(limit) ) {
      return res.status(500).send("Invalid Request");
  }

  limit = Math.min(10000,Math.max(1,limit));

  Query({
      name: 'AuthorsList',
      text: "select au_id, au_name, au_notes,count(mo_id) as count from fgs_authors,fgs_models where au_id=mo_author group by au_id order by au_name asc limit $1 offset $2 ",
      values: [ limit, offset ]
    }, function(err, result) {

    if(err) {
      return res.status(500).send("Database Error");
    }

    var j = [];
    result.rows.forEach(function(row){
      j.push({
        'id': row.au_id,
        'name': row.au_name,
        'notes': row.au_notes,
        'models': row.count,
      });
    });
    res.json(j);
  });
})

router.get('/models/bymg/:mg/:limit/:offset?', function(req, res, next) {

  var mg = Number(req.params.mg || 0);
  var offset = Number(req.params.offset || 0);
  var limit = Number(req.params.limit||0);

  if( isNaN(offset) || isNaN(limit) || isNaN(mg) ) {
      return res.status(500).send("Invalid Request");
  }

  limit = Math.min(10000,Math.max(1,limit));

  Query({
      name: 'ModelsListByMg',
      text: "select mo_id, mo_path, mo_name, mo_notes, mo_shared, mo_modified,mo_author,au_name from fgs_models,fgs_authors where au_id=mo_author and mo_shared=$1 order by mo_modified desc limit $2 offset $3",
      values: [ mg, limit, offset ]
    }, function(err, result) {

    if(err) {
      return res.status(500).send("Database Error");
    }

    var j = [];
    result.rows.forEach(function(row){
      j.push({
        'id': row.mo_id,
        'filename': row.mo_path,
        'name': row.mo_name,
        'notes': row.mo_notes,
        'shared': row.mo_shared,
        'modified': row.mo_modified,
        'author': row.au_name,
        'authorId': row.mo_author,
      });
    });
    res.json(j);
  });
});

router.get('/models/list/:limit/:offset?', function(req, res, next) {

  var offset = Number(req.params.offset || 0);
  var limit = Number(req.params.limit||0);

  if( isNaN(offset) || isNaN(limit) ) {
      return res.status(500).send("Invalid Request");
  }

  limit = Math.min(10000,Math.max(1,limit));

  Query({
      name: 'ModelsList',
      text: "select mo_id, mo_path, mo_name, mo_notes, mo_shared, mo_modified,mo_author,au_name from fgs_models,fgs_authors where au_id=mo_author order by mo_modified desc limit $1 offset $2 ",
      values: [ limit, offset ]
    }, function(err, result) {

    if(err) {
      return res.status(500).send("Database Error");
    }

    var j = [];
    result.rows.forEach(function(row){
      j.push({
        'id': row.mo_id,
        'filename': row.mo_path,
        'name': row.mo_name,
        'notes': row.mo_notes,
        'shared': row.mo_shared,
        'modified': row.mo_modified,
        'author': row.au_name,
        'authorId': row.mo_author,
      });
    });
    res.json(j);
  });
});

router.get('/model/:id/tgz', function(req, res, next) {
  var id = Number(req.params.id || 0);
  if( isNaN(id) ) {
      return res.status(500).send("Invalid Request");
  }
  
  Query({
      name: 'ModelsTarball',
      text: "select mo_modelfile from fgs_models where mo_id = $1",
      values: [ id ]
    }, function(err, result) {

    if(err) return res.status(500).send("Database Error");
    if( 0 == result.rows.length ) return res.status(404).send("model not found");
    if( result.rows[0].mo_modelfile == null ) return res.status(404).send("no modelfile");

    var buf = new Buffer(result.rows[0].mo_modelfile, 'base64');
    res.writeHead(200, {'Content-Type': 'application/gzip'});
//Response.AppendHeader("content-disposition", "attachment; filename=\"" + fileName +"\"");
    res.end(buf);
  });
});

router.get('/model/:id/thumb', function(req, res, next) {
  var id = Number(req.params.id || 0);
  if( isNaN(id) ) {
      return res.status(500).send("Invalid Request");
  }
  
  Query({
      name: 'ModelsThumb',
      text: "select mo_thumbfile from fgs_models where mo_id = $1",
      values: [ id ]
    }, function(err, result) {

    if(err) {
      return res.status(500).send("Database Error");
    }

    if( 0 == result.rows.length ) {
      return res.status(404).send("model not found");
    }

    if( result.rows[0].mo_thumbfile == null ) 
      return res.status(404).send("no thumbfile");

    var buf = new Buffer(result.rows[0].mo_thumbfile, 'base64');
    res.writeHead(200, {'Content-Type': 'image/jpeg'});
    res.end(buf);
  });
});

var util = require('util');
var stream = require('stream');
var MultiStream = function (object, options) {
  if (object instanceof Buffer || typeof object === 'string') {
    options = options || {};
    stream.Readable.call(this, {
      highWaterMark: options.highWaterMark,
      encoding: options.encoding
    });
  } else {
    stream.Readable.call(this, { objectMode: true });
  }
  this._object = object;
};

util.inherits(MultiStream, stream.Readable);

MultiStream.prototype._read = function () {
  this.push(this._object);
  this._object = null;
};

router.get('/model/:id/positions', function(req, res, next) {
  var id = Number(req.params.id || 0);
  if( isNaN(id) ) {
      return res.status(500).send("Invalid Request");
  }
  
  Query({
      name: 'ModelPositions',
      text: "select ob_id, ST_AsGeoJSON(wkb_geometry),ob_country,ob_gndelev from fgs_objects where ob_model = $1 order by ob_country",
      values: [ id ]
    }, function(err, result) {

    if(err) {
      return res.status(500).send("Database Error")
    }
    var featureCollection = {
      type: "FeatureCollection",
      features: []
    }
    result.rows.forEach(function(r) {
      featureCollection.features.push({
        type: "Feature",
        geometry: JSON.parse(r.st_asgeojson),
        id: r.ob_id,
        properties: {
          id: r.ob_id,
          gndelev: r.ob_gndelev,
          country: r.ob_country,
        }
      }) 
    })
    return res.json(featureCollection)
  })
})

router.get('/model/:id', function(req, res, next) {
  var id = Number(req.params.id || 0);
  if( isNaN(id) ) {
      return res.status(500).send("Invalid Request");
  }
  
  Query({
      name: 'ModelDetail',
      text: "select mo_id,mo_path,mo_modified,mo_author,mo_name,mo_notes,mo_modelfile,mo_shared,au_name from fgs_models left join fgs_authors on mo_author=au_id where mo_id = $1",
      values: [ id ]
    }, function(err, result) {

    if(err) {
      return res.status(500).send("Database Error")
    }

    if( 0 == result.rows.length ) {
      return res.status(404).send("model not found")
    }

    var row = result.rows[0]
    var ret = {
        'id': row.mo_id,
        'filename': row.mo_path,
        'modified': row.mo_modified,
        'authorId': row.mo_author,
        'name': row.mo_name,
        'notes': row.mo_notes,
        'shared': row.mo_shared,
        'author': row.au_name,
        'authorId': row.mo_author,
        'content': [],
    }
    var streambuf = new MultiStream( new Buffer(result.rows[0].mo_modelfile, 'base64') )
    streambuf.on('end',(a) => { res.json(ret) })

    streambuf.pipe(
      tar.t({
        onentry: entry => { 
          ret.content.push({
            filename: entry.header.path,
            filesize: entry.header.size,
          })
        }
      })
    )
  });
});

router.get('/models/datatable', function(req, res, next) {
  var draw = toNumber(req.query.draw);
  var start = toNumber(req.query.start);
  var length = toNumber(req.query.length);

  req.query.search = req.query.search || {}
  var search = req.query.search.value || '';

  order = req.query.order || [{ column: '1', dir: 'asc' }];

  var order_cols = {
    '1': 'mo_id',
    '2': 'mo_name',
    '3': 'mo_path',
    '4': 'mo_notes',
    '5': 'mo_modified',
    '6': 'mo_shared',
  }
  order_col = order_cols[toNumber(order[0].column)] || 'mo_id';
  order_dir = order[0].dir === 'asc' ? 'ASC' : 'DESC';

  //TODO: need to construct prepared statements for each order/dir combination
  var queryArgs = //search == '' ? 
//    {
//      name: 'ModelsListDatatable',
//      text: "select mo_id, mo_path, mo_name, mo_notes, mo_modified, mo_shared from fgs_models order by mo_modified desc limit $1 offset $2",
//      values: [ length, start ]
//    } :
    {
      name: 'ModelsSearchDatatable',
      text: "select mo_id, mo_path, mo_name, mo_notes, mo_modified, mo_shared from fgs_models where mo_path ilike $3 or mo_name ilike $3 or mo_notes ilike $3 order by mo_modified desc limit $1 offset $2",
      values: [ length, start, "%" + search + "%" ]
    };

  Query(queryArgs, function(err, result) {
    if(err) return res.status(500).send("Database Error");

    var j = [];
    result.rows.forEach(function(row){
      j.push({
        'id': row.mo_id,
        'filename': row.mo_path,
        'name': row.mo_name,
        'notes': row.mo_notes,
        'shared': row.mo_shared,
        'modified': row.mo_modified,
      });
    });

    Query({
      name: 'CountModels',
      text: 'select count(*) from fgs_models',
    }, function(err,result) {
      if(err) return res.status(500).send("Database Error");

      var count = result.rows[0].count;

      res.json({
        'draw': draw,
        'recordsTotal': count,
        'recordsFiltered': search == '' ? count : j.length,
        'data': j,
      });
    });
  });
});

router.get('/modelgroup/:id?', function(req, res, next) {
  var QueryArgs = req.params.id ?
  {
      name: 'ModelGroupsRead',
      text: "select mg_id, mg_name from fgs_modelgroups where mg_id = $1",
      values: [ toNumber(req.params.id) ]
  } :
  {
      name: 'ModelGroupsReadAll',
      text: "select mg_id, mg_name from fgs_modelgroups order by mg_id",
  };
  Query(QueryArgs, function(err, result) {

    if(err) {
      return res.status(500).send("Database Error");
    }

    var j = [];
    result.rows.forEach(function(row){
      j.push({
        'id': row.mg_id,
        'name': row.mg_name,
      });
    });
    res.json(j);
  });
});

router.get('/models/search/:pattern', function(req, res, next) {

  Query({
      name: 'ModelsSearch',
      text: "select mo_id, mo_path,mo_name,mo_notes,mo_shared,mo_modified from fgs_models where mo_path like $1 or mo_name like $1 or mo_notes like $1",
      values: [ "%" + req.params.pattern + "%" ]
    }, function(err, result) {

    if(err) return res.status(500).send("Database Error");

    var j = [];
    result.rows.forEach(function(row){
      j.push({
        'id': row.mo_id,
        'filename': row.mo_path,
        'name': row.mo_name,
        'notes': row.mo_notes,
        'shared': row.mo_shared,
        'modified': row.mo_modified,
      });
    });
    res.json(j);
  });
});

router.get('/models/search/byauthor/:id/:limit?/:offset?', function(req, res, next) {

  var id = Number(req.params.id || 0);
  var offset = Number(req.params.offset || 0);
  var limit = Number(req.params.limit||20);
  Query({
      name: 'ModelsSearchByAuthor',
      text: "select mo_id,mo_path,mo_name,mo_notes,mo_shared,mo_modified,mo_author,au_name from fgs_models,fgs_authors where au_id=mo_author and mo_author=$1 or mo_modified_by=$1 ORDER BY mo_modified DESC limit $2 offset $3",
      values: [ id, limit, offset ]
    }, function(err, result) {

    if(err) return res.status(500).send("Database Error");

    var j = [];
    result.rows.forEach(function(row){
      j.push({
        'id': row.mo_id,
        'filename': row.mo_path,
        'name': row.mo_name,
        'notes': row.mo_notes,
        'shared': row.mo_shared,
        'modified': row.mo_modified,
        'author': row.au_name,
        'authorId': row.mo_author,
      });
    });
    res.json(j);
  });
});

router.get('/navdb/airport/:icao', function(req, res, next) {

  if( !req.params.icao.match( /^[A-Za-z0-9]*$/ ) ) {
    return res.json({})
  }
  Query({
      name: 'ModelsSearchByAuthor',
//      text: "SELECT pr_id, pr_runways, pr_name, pr_type FROM fgs_procedures WHERE pr_airport = UPPER($1);",
      text: "select ST_AsGeoJSON(wkb_geometry) as rwy from apt_runway where icao=UPPER($1);",
      values: [ req.params.icao ]
    }, function(err, result) {

    if(err) return res.status(500).send("Database Error");

    var j = { 
        'runwaysGeometry': { 
            'type': 'GeometryCollection', 
            'geometries': [] 
        },
        'procedures': [] 
    }
    result.rows.forEach(function(row){
      j.runwaysGeometry.geometries.push(JSON.parse(row.rwy));
    });
    res.json(j);
  });
});

module.exports = router;
