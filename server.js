const {Datastore} = require('@google-cloud/datastore');
const bodyParser = require('body-parser');
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const jwt = require('express-jwt');
const jwksRsa = require('jwks-rsa');
const jwt_decode = require('jwt-decode');

const datastore = new Datastore();
const router = express.Router();
const app = express();
const USER = "User";
const BOAT = "Boat";
const LOAD = "Load";
const PAGE_SIZE = 5;

const checkJwt = jwt({
  secret: jwksRsa.expressJwtSecret({
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 5,
    jwksUri: 'https://www.googleapis.com/oauth2/v3/certs'
  }),
  issuer: 'https://accounts.google.com',
  algorithms: ['RS256']
});

app.use(session({secret:'ABCD'}));
app.use(bodyParser.json());
app.use('/', router);

/* ------------- Begin OAuth Controller Functions ------------- */
router.get('/', function(req, res){
    var secretStr = '';
    var charSet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for(var i = 0; i < 20; i++){
      secretStr += charSet.charAt(Math.floor(Math.random()*charSet.length));
    }
    req.session.state = secretStr;
    var html = '<div style="text-align:center;">' +
                  '<h1>Welcome</h1>' +
                  '<h2>This is a student project for Ryan Adams ' +
                  'at Oregon State University. Please click the button to ' +
                  'Sign up or Login to the final project API using Google.</h2>' +
                  '<a href="https://accounts.google.com/o/oauth2/v2/auth?' +
                  'response_type=code&' +
                  'client_id=[redacted]&' +
                  'redirect_uri=https://adamsrya-assignment-final.wl.r.appspot.com/oauth&' +
                  'scope=profile&' + 
                  'state=' + req.session.state + '">click me</a>' +
               '</div>';
    res.status(200).type("text/html").send(html);
});

router.get('/oauth', async (req, res) => {
  if(req.session.state !== req.query.state){
    var errorHTML = '<div style="text-align:center;">' +
                      '<h1>Error: State strings do not match</h1>' +
                      '<a href ="/">return home</a>' +
                    '</div>';
    res.status(200).type("text/html").send(errorHTML);
  } else{
    var tokenData = await axios.post('https://www.googleapis.com/oauth2/v4/token',
    {
      code:req.query.code,
      client_id:'[redacted]',
      client_secret:'[redacted]',
      redirect_uri:'https://adamsrya-assignment-final.wl.r.appspot.com/oauth',
      grant_type:'authorization_code'
    }).then(res => {
      return res.data;
    }).catch(error => {
      console.error(error);
    })

    var decoded = jwt_decode(tokenData.id_token);
    q = datastore.createQuery(USER).filter('user_id', '=', decoded.sub);
    await datastore.runQuery(q).then( (entities) => {
        if(entities[0].length == 0){
            var new_user = {"user_id": decoded.sub, "fname": decoded.given_name, "lname": decoded.family_name, "locale": decoded.locale}
            var key = datastore.key(USER);
            datastore.save({"key":key, "data":new_user});
        }
    });

    var successHTML = '<div style="text-align:center;">' +
                        '<h1>User Info</h1>' +
                        '<h2>User ID:</h2>' +
                        '<span style="display:block;width:100%;word-wrap:break-word;">' + decoded.sub + '</span>' +
                        '<h2>JWT:</h2>' +
                        '<span style="display:block;width:100%;word-wrap:break-word;">' + tokenData.id_token + '</span>' +
                        '<a href ="/">return home</a>' +
                      '</div>';
    res.status(200).type("text/html").send(successHTML);
  }
});
/* ------------- End OAuth Controller Functions ------------- */

/* ------------- Begin Helper Functions ------------- */
function fromDatastore(item){
  item.id = item[Datastore.KEY].id;
  return item;
}
/* ------------- End Helper Functions ------------- */

/* ------------- Begin User Model Functions ------------- */
function get_users(){
    var q = datastore.createQuery(USER);
    return datastore.runQuery(q).then( (entities) => {
        return entities[0];
    });
}
/* ------------- End User Model Functions ------------- */

/* ------------- Begin User Controller Functions ------------- */
router.get('/users', function(req, res){
    var accept = req.header("Accept");
    if(!accept.includes("application/json") &&
       !accept.includes("*/*")) {
        res.status(406).json({"Error": "Unsupported response content type requested by client"})
    } else {
        get_users()
        .then( (results) => {
            res.status(200).json(results);
        });
    }
});
/* ------------- End User Controller Functions ------------- */

/* ------------- Begin Boat Model Functions ------------- */
async function get_boats(sub, pageCursor){
    var q_full = datastore.createQuery(BOAT).filter('owner', '=', sub);
    var total_num = await datastore.runQuery(q_full).then( (results) => {
        return results[0].length;
    });

    var q = datastore.createQuery(BOAT).filter('owner', '=', sub).limit(PAGE_SIZE);
    if(pageCursor){
        q = q.start(pageCursor);
    }

    return datastore.runQuery(q).then( (results) => {
        const entities = results[0].map(fromDatastore);
        const info = [results[1], total_num];
		return [entities, info];
    });
}

function get_boat(boat_id){
	const key = datastore.key([BOAT, parseInt(boat_id,10)]);
	return datastore.get(key).then( (entity) => {return entity});
}

function post_boat(name, type, length, sub){
  var key = datastore.key(BOAT);
  const new_boat = {"name": name, "type": type, "length": length, "loads":[], "owner":sub};
  return datastore.save({"key":key, "data":new_boat}).then( () => {return key});
}

function edit_boat(boat_id, name, type, length, sub){
    var key = datastore.key([BOAT, parseInt(boat_id,10)]);
    return datastore.get(key).then( (entity) => {
        var found_boat = entity[0];
        if(found_boat != undefined){
            if(found_boat.owner !== sub){
                return found_boat;
            }

            var updated_boat = {
                "name": name,
                "type": type,
                "length": length,
                "owner": sub,
                "loads": found_boat.loads
            };
            if(updated_boat.type == undefined){
                updated_boat.type = found_boat.type;
            }
            if(updated_boat.length == undefined){
                updated_boat.length = found_boat.length;
            }
            if(updated_boat.name == undefined){
                updated_boat.name = found_boat.name;
            }
            return datastore.save({"key":key, "data":updated_boat}).then( () => {return key});
        }
        return undefined;
    });
}

function delete_boat(boat_id, sub){
  const key = datastore.key([BOAT, parseInt(boat_id,10)]);
  return datastore.get(key).then( async (boat_entity) => {
        var found_boat = boat_entity[0];
        console.log(found_boat);
        console.log(found_boat != undefined);
        if(found_boat != undefined){
            console.log("log 1");
            if(found_boat.owner !== sub){
                console.log("not correct owner");
                return found_boat;
            }
            for(var i = 0; i < found_boat.loads.length; i++){
                console.log("inside loop " + i);
                await delete_load_in_boat(found_boat.loads[i].id, boat_id);

                if(i === (found_boat.loads.length - 1)){
                    return datastore.delete(key).then( () => {
                        console.log("deleted");
                        return key;
                    });
                }
            }
            return datastore.delete(key).then( () => {
                console.log("deleted");
                return key;
            });
        } else {
            return undefined;
        }
  });
}
/* ------------- End Boat Model Functions ------------- */

/* ------------- Begin Boat Controller Functions ------------- */
app.use(function (err, req, res, next) {
    if (err.name === 'UnauthorizedError') {
        res.status(401).json({"Error": "Unauthorized request"});
    }
});

router.get('/boats', checkJwt, function(req, res){
    var accept = req.header("Accept");
    if(!accept.includes("application/json") &&
       !accept.includes("*/*")) {
        res.status(406).json({"Error": "Unsupported response content type requested by client"})
    } else {
        const self = "https://adamsrya-assignment-final.wl.r.appspot.com";
        get_boats(req.user.sub, req.query.pageCursor)
        .then( (results) => {
            results[0].forEach( (element) => {
                element.self = self + "/boats/" + element.id;
                element.loads.forEach( (load) => {
                    load.self = self + "/loads/" + load.id;
                });
            });
            if(results[1][0].moreResults === Datastore.MORE_RESULTS_AFTER_LIMIT){
                results[1] = {"next": self + "/boats?pageCursor=" + results[1][0].endCursor, "total_results": results[1][1]};
            } else {
                results[1] = {"next": null, "total_results": results[1][1]};
            }
            res.status(200).json(results);
        });
    }
});

router.get('/boats/:boat_id', checkJwt, function(req, res){
    var accept = req.header("Accept");
    if(!accept.includes("application/json") &&
       !accept.includes("*/*")) {
        res.status(406).json({"Error": "Unsupported response content type requested by client"})
    } else {
        const self = "https://adamsrya-assignment-final.wl.r.appspot.com";
        get_boat(req.params.boat_id)
        .then( (entity) => {
            if(entity[0] != undefined){
                if(entity[0].owner === req.user.sub){
                    entity[0].self = self + "/boats/" + req.params.boat_id;
                    entity[0].id = req.params.boat_id;
                    entity[0].loads.forEach( (load) => {
                        load.self = self + "/loads/" + load.id;
                    });
                    res.status(200).json(entity[0]);
                } else {
                    res.status(403).json({"Error": "Forbidden request"})
                }
            } else{
                res.status(404).json({"Error": "No boat with this boat_id exists"});
            }
        });
    }
});

router.post('/boats', checkJwt, function(req, res){
    var accept = req.header("Accept");
    if(!accept.includes("application/json") &&
       !accept.includes("*/*")) {
        res.status(406).json({"Error": "Unsupported response content type requested by client"})
    } else {
        post_boat(req.body.name, req.body.type, req.body.length, req.user.sub)
        .then( (key) => {
            const self = "https://adamsrya-assignment-final.wl.r.appspot.com/boats/" + key.id;
            const new_boat = {
                "name": req.body.name,
                "type": req.body.type,
                "length": req.body.length,
                "owner": req.user.sub,
                "loads": [],
                "id": key.id,
                "self": self
            };
            res.status(201).json(new_boat);
        });
    }
});

router.put('/boats/:boat_id', checkJwt, function(req, res){
    var accept = req.header("Accept");
    if(!accept.includes("application/json") &&
       !accept.includes("*/*")) {
        res.status(406).json({"Error": "Unsupported response content type requested by client"})
    } else {
        edit_boat(req.params.boat_id, req.body.name, req.body.type, req.body.length, req.user.sub)
        .then( (entity) => {
            if(datastore.isKey(entity)){
                const self = "https://adamsrya-assignment-final.wl.r.appspot.com/boats/" + req.params.boat_id;
                res.location(self).status(303).end();
            } else if(entity != undefined){
                res.status(403).json({"Error": "Forbidden request"});
            } else {
                res.status(404).json({"Error": "No boat with this boat_id exists"});
            }
        });
    }
});

router.put('/boats', function(req, res){
    res.status(405).json({"Error": "API does not support editing the entire list of boats"});
});

router.patch('/boats/:boat_id', checkJwt, function(req, res){
    var accept = req.header("Accept");
    if(!accept.includes("application/json") &&
       !accept.includes("*/*")) {
        res.status(406).json({"Error": "Unsupported response content type requested by client"})
    } else {
        edit_boat(req.params.boat_id, req.body.name, req.body.type, req.body.length, req.user.sub)
        .then( (entity) => {
            if(datastore.isKey(entity)){
                const self = "https://adamsrya-assignment-final.wl.r.appspot.com/boats/" + req.params.boat_id;
                res.location(self).status(303).end();
            } else if(entity != undefined){
                res.status(403).json({"Error": "Forbidden request"});
            } else {
                res.status(404).json({"Error": "No boat with this boat_id exists"});
            }
        });
    }
});

router.patch('/boats', function(req, res){
    res.status(405).json({"Error": "API does not support editing the entire list of boats"});
});

router.delete('/boats/:boat_id', checkJwt, function(req, res){
    console.log(req.params.boat_id);
    console.log(req.user.sub);
    delete_boat(req.params.boat_id, req.user.sub)
    .then( (entity) => {
        console.log(entity);
        if (datastore.isKey(entity)){
            res.status(204).end();
        } else if(entity != undefined){
            res.status(403).json({"Error": "Forbidden request"});
        } else {
            res.status(404).json({"Error": "No boat with this boat_id exists"});
        }
    });
});

router.delete('/boats', function(req, res){
    res.status(405).json({"Error": "API does not support deleting the entire list of boats"});
});
/* ------------- End Boat Controller Functions ------------- */

/* ------------- Begin Load Model Functions ------------- */
async function get_loads(pageCursor){
    var q_full = datastore.createQuery(LOAD);
    var total_num = await datastore.runQuery(q_full).then( (results) => {
        return results[0].length;
    });

    var q = datastore.createQuery(LOAD).limit(PAGE_SIZE);
    if(pageCursor){
        q = q.start(pageCursor);
    }
	return datastore.runQuery(q).then( (results) => {
        const entities = results[0].map(fromDatastore);
        const info = [results[1], total_num];
		return [entities, info];
	});
}

function get_load(load_id){
	const key = datastore.key([LOAD, parseInt(load_id,10)]);
	return datastore.get(key).then( (entity) => {return entity});
}

function post_load(weight, content, delivery_date){
    var key = datastore.key(LOAD);
	const new_load = {"weight": weight, "content": content, "delivery_date": delivery_date, "carrier": null};
	return datastore.save({"key":key, "data":new_load}).then( () => {return key});
}

function edit_load(load_id, content, weight, delivery_date){
    var key = datastore.key([LOAD, parseInt(load_id,10)]);
    return datastore.get(key).then( (entity) => {
        var found_load = entity[0];
        if(found_load != undefined){
            var updated_load = {
                "content": content,
                "weight": weight,
                "delivery_date": delivery_date,
                "carrier": found_load.carrier
            };
            if(updated_load.content == undefined){
                updated_load.content = found_load.content;
            }
            if(updated_load.weight == undefined){
                updated_load.weight = found_load.weight;
            }
            if(updated_load.delivery_date == undefined){
                updated_load.delivery_date = found_load.delivery_date;
            }
            return datastore.save({"key":key, "data":updated_load}).then( () => {return key});
        }
        return undefined;
    });
}

function delete_load(load_id){
    const key = datastore.key([LOAD, parseInt(load_id,10)]);
    return datastore.get(key).then( async (entity) => {
        if(entity[0] != undefined){
            if(entity[0].carrier != null){
                await delete_load_in_boat(load_id, entity[0].carrier.id);
            }
            return datastore.delete(key).then( () => {return entity});
        }
        return entity;
    });
}

function put_load_in_boat(load_id, boat_id){
    const load_key = datastore.key([LOAD, parseInt(load_id,10)]);
    const boat_key = datastore.key([BOAT, parseInt(boat_id,10)]);
    return datastore.get(load_key).then( (load_entity) => {
        if(load_entity[0] != undefined){
            return datastore.get(boat_key).then( (boat_entity) => {
                if(boat_entity[0] != undefined && load_entity[0].carrier == null){
                    load_entity[0].carrier = {
                        "id": boat_key.id,
                        "name": boat_entity[0].name
                    };
                    return datastore.save({"key": load_key, "data":load_entity[0]}).then( () => {
                        boat_entity[0].loads.push({"id": load_key.id});
                        return datastore.save({"key": boat_key, "data": boat_entity[0]}).then( () => {
                            return [load_key, boat_key];
                        });
                    });
                }
                return boat_entity;
            });
        }
        return load_entity;
    });
}

function delete_load_in_boat(load_id, boat_id){
    const load_key = datastore.key([LOAD, parseInt(load_id,10)]);
    const boat_key = datastore.key([BOAT, parseInt(boat_id,10)]);
    return datastore.get(load_key).then( (load_entity) => {
        if(load_entity[0] != undefined){
            return datastore.get(boat_key).then( (boat_entity) => {
                if((boat_entity[0] != undefined && load_entity[0].carrier != null) && load_entity[0].carrier.id == boat_id){
                    load_entity[0].carrier = null;
                    return datastore.save({"key": load_key, "data":load_entity[0]}).then( () => {
                        boat_entity[0].loads.splice(boat_entity[0].loads
                            .findIndex((element) => element.id == load_id, 1)
                        );
                        return datastore.save({"key": boat_key, "data": boat_entity[0]}).then( () => {
                            return [load_key, boat_key];
                        });
                    });
                }
                return boat_entity;
            });
        }
        return load_entity;
    });
}
/* ------------- End Load Model Functions ------------- */

/* ------------- Begin Load Controller Functions ------------- */
router.get('/loads', function(req, res){
    var accept = req.header("Accept");
    if(!accept.includes("application/json") &&
       !accept.includes("*/*")) {
        res.status(406).json({"Error": "Unsupported response content type requested by client"})
    } else {
        const self = "https://adamsrya-assignment-final.wl.r.appspot.com";
        get_loads(req.query.pageCursor)
        .then( (results) => {
            results[0].forEach( (element) => {
                element.self = self + "/loads/" + element.id;
                if(element.carrier != null){
                    element.carrier.self = self + "/boats/" + element.carrier.id;
                }
            });
            if(results[1][0].moreResults === Datastore.MORE_RESULTS_AFTER_LIMIT){
                results[1] = {"next": self + "/loads/?pageCursor=" + results[1][0].endCursor, "total_results": results[1][1]};
            } else {
                results[1] = {"next": null, "total_results": results[1][1]};
            }
            res.status(200).json(results);
        });
    }
});

router.get('/loads/:load_id', function(req, res){
    var accept = req.header("Accept");
    if(!accept.includes("application/json") &&
       !accept.includes("*/*")) {
        res.status(406).json({"Error": "Unsupported response content type requested by client"})
    } else {
        const self = "https://adamsrya-assignment-final.wl.r.appspot.com";
        get_load(req.params.load_id)
        .then( (entity) => {
            if(entity[0] != undefined){
                entity[0].self = self + "/loads/" + req.params.load_id;
                entity[0].id = req.params.load_id;
                if(entity[0].carrier != null){
                    entity[0].carrier.self = self + "/boats/" + entity[0].carrier.id;
                }
                res.status(200).json(entity[0]);
            }
            res.status(404).json({"Error": "No load with this load_id exists"});
        });
    }
});

router.post('/loads', function(req, res){
    var accept = req.header("Accept");
    if(!accept.includes("application/json") &&
       !accept.includes("*/*")) {
        res.status(406).json({"Error": "Unsupported response content type requested by client"})
    } else {
        if ((req.body.weight && req.body.content) && req.body.delivery_date){
            post_load(req.body.weight, req.body.content, req.body.delivery_date)
            .then( (key) => {
                const self = "https://adamsrya-assignment-final.wl.r.appspot.com/loads/" + key.id;
                const new_load = {
                    "weight": req.body.weight,
                    "content": req.body.content,
                    "delivery_date": req.body.delivery_date,
                    "carrier": null,
                    "id": key.id,
                    "self": self
                };
                res.status(201).json(new_load);
            });
        } else {
            res.status(400).json({"Error": "The request object is missing at least one of the required attributes"});
        }
    }
});

router.put('/loads/:load_id', function(req, res){
    var accept = req.header("Accept");
    if(!accept.includes("application/json") &&
       !accept.includes("*/*")) {
        res.status(406).json({"Error": "Unsupported response content type requested by client"})
    } else {
        edit_load(req.params.load_id, req.body.content, req.body.weight, req.body.delivery_date)
        .then( (entity) => {
            if(datastore.isKey(entity)){
                const self = "https://adamsrya-assignment-final.wl.r.appspot.com/loads/" + req.params.load_id;
                res.location(self).status(303).end();
            } else if(entity != undefined){
                res.status(403).json({"Error": "Forbidden request"});
            } else {
                res.status(404).json({"Error": "No load with this load_id exists"});
            }
        });
    }
});

router.put('/loads', function(req, res){
    res.status(405).json({"Error": "API does not support editing the entire list of loads"});
});

router.patch('/loads/:load_id', function(req, res){
    var accept = req.header("Accept");
    if(!accept.includes("application/json") &&
       !accept.includes("*/*")) {
        res.status(406).json({"Error": "Unsupported response content type requested by client"})
    } else {
        edit_load(req.params.load_id, req.body.content, req.body.weight, req.body.delivery_date)
        .then( (entity) => {
            if(datastore.isKey(entity)){
                const self = "https://adamsrya-assignment-final.wl.r.appspot.com/loads/" + req.params.load_id;
                res.location(self).status(303).end();
            } else if(entity != undefined){
                res.status(403).json({"Error": "Forbidden request"});
            } else {
                res.status(404).json({"Error": "No load with this load_id exists"});
            }
        });
    }
});

router.patch('/loads', function(req, res){
    res.status(405).json({"Error": "API does not support editing the entire list of loads"});
});

router.delete('/loads/:load_id', function(req, res){
    delete_load(req.params.load_id)
    .then( (entity) => {
        if (entity[0] != undefined){
            res.status(204).end();
        } else {
            res.status(404).json({"Error": "No load with this load_id exists"});
        }
    });
});

router.delete('/loads', function(req, res){
    res.status(405).json({"Error": "API does not support deleting the entire list of loads"});
});

router.put('/boats/:boat_id/loads/:load_id', function(req, res){
    put_load_in_boat(req.params.load_id, req.params.boat_id)
    .then( (promises) => {
        if (datastore.isKey(promises[0])){
            res.status(204).end();
        }else if (promises[0] != undefined){
            res.status(403).json({"Error": "The load is already on a boat"});
        } else {
            res.status(404).json({"Error": "The specified boat and/or load does not exist"});
        }
    });
});

router.delete('/boats/:boat_id/loads/:load_id', function(req, res){
    delete_load_in_boat(req.params.load_id, req.params.boat_id)
    .then( (promise) => {
        if (datastore.isKey(promise[0])){
            res.status(204).end();
        } else {
            res.status(404).json({"Error": "No boat with this boat_id has a load with this load_id"});
        }
    });
});
/* ------------- End Load Controller Functions ------------- */

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}...`);
});