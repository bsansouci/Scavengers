var express = require("express");
var logfmt = require("logfmt");
var mongoose = require ("mongoose"); // The reason for this demo.
var fs = require('fs');
var path = require('path');
var app = express();
var port = process.env.PORT || 5000;

// Here we find an appropriate database to connect to, defaulting to
// localhost if we don't find one.
var uristring =
process.env.MONGOLAB_URI ||
process.env.MONGOHQ_URL ||
'mongodb://localhost/db';

// The http server will listen to an appropriate port, or default to
// port 5000.
var theport = process.env.PORT || 5000;

var userSchema = new mongoose.Schema({
  username: String,
  points: Number,
  currentHunt: mongoose.Schema.ObjectId,
  waypoints: [{
    id: mongoose.Schema.ObjectId,
    status: String, //Could be DONE, DOING, SKIPPED
    targetName: String,
  }],
  commonText: String
});

var waypointSchema = new mongoose.Schema({
  huntId: mongoose.Schema.ObjectId,
  location: {
    latitude: Number,
    longitude: Number
  },
  type: String,
  question: String, // This could be a URL of an image
  answer: String,
  hint: String
});

var locationSchema = new mongoose.Schema({
  time: Number,
  username: String,
  location: {
    latitude: Number,
    longitude: Number
  }
})

var userLikeSomethingHeDid = new mongoose.Schema({
  time: Number,
  username: String,
  action: {
    type: String,
    text: String,
    image: String
  }
});

var huntSchema = new mongoose.Schema({
  name: String,
  description: String,
  owner: String
});

var PUser = mongoose.model('allUsers', userSchema);
var PWaypoint = mongoose.model('waypoints', waypointSchema);
var PLocation = mongoose.model('locations', locationSchema);
var PHunt = mongoose.model('hunts', huntSchema);
var PUserLikeSomethingHeDid = mongoose.model('actions', userLikeSomethingHeDid);




// Makes connection asynchronously.  Mongoose will queue up database
// operations and release them when the connection is complete.
mongoose.connect(uristring, function (err, res) {
  if (err) {
    console.log ('ERROR connecting to: ' + uristring + '. ' + err);
  } else {
    console.log ('Succeeded connected to: ' + uristring);
  }
});

app.use(logfmt.requestLogger({immediate: true}, function(req, res){
  res.setHeader("Access-Control-Allow-Origin", "*");

  return {
    method: req.method
  };
}));

// app.use(logfmt.requestLogger()).use(function(req, res, next){
//   res.setHeader("Access-Control-Allow-Origin", "*");
//   next();
// });

app.get('/', function(req, res) {
  res.send({});
});

// app.get('/parseDatShit', function(req, res){
//   var sendMeBack;
//   PLocation.find({}).exec(function (err, locations) {
//     sendMeBack = locations;
//     PLocation.find({}).exec(function (err, locations) {
//       locations[0].time = 1390136986768;
//       for (var i = 1; i < locations.length; i++) {
//         locations[i].time = locations[i - 1].time + Math.random() * 10000 + 5000;
//         if(locations[i].username === "ben") {
//           locations[i].username = "benjamin.sansouci";
//         }
//         locations[i].save();
//       }
//       res.send(sendMeBack);
//     });
//   });
// });

app.get('/movewaypoint', function (req, res) {
  var id = req.query.id;
  var lat = parseFloat(req.query.lat);
  var lon = parseFloat(req.query.lon);
  console.log(req.query);
  PWaypoint.find({}).where("_id").equals(id).exec(function(waypoint){

    waypoint.lat = lat;
    waypoint.lon = lon;
    waypoint.save();
    res.send({});
  })
});

app.get('/bigdata', function(req, res){
  var since = parseInt(req.query.since);
  var huntId = req.query.huntId;
  console.log(req.query);

  PLocation.find({}).where("time").gt(since).exec(function(err, locs){
    if(err)
      console.log(err);
    // console.log(locs);
    PUserLikeSomethingHeDid.find({}).where("time").gt(since).exec(function(err, acts){
      if(err)
        console.log(err);
      PWaypoint.find({huntId: huntId}).exec(function(err, waypoints){
        console.log(locs);
        console.log(acts);
        res.send({
          locations: locs,
          actions: acts,
          waypoints: waypoints
        });
      });
    })
  });
});

app.get('/hunt', function(req, res){
  var data = req.query;
  var hunt = new PHunt(data);

  hunt.save(function(err){})

  res.send({
    ID: hunt._id
  });
});

app.get('/pts', function(req, res){
  PUser.findOne({username: req.query.username}).exec(function(err, user){
    req.send({
      points: user.points
    });
  });
});

app.get('/waypoint', function(req, res){
  var data = req.query;
  console.log(data);
  var waypoint = new PWaypoint({
    huntId: data.huntId,
    type: data.type,
    question: data.question,
    answer: data.answer,
    location: {
      latitude: parseFloat(data.latitude),
      longitude: parseFloat(data.longitude)
    },
    hint: data.hint
  });

  waypoint.save(function(err){
    res.send(waypoint);
  });
});

app.get('/action', function(req, res){
  var data = req.query;

  switch(data.actionType) {
    case "PICK":
      PUser.findOne({username: data.username}).exec(function(err, user){
        user.currentHunt = data.text;
        user.save(function(err){});

        PWaypoint.findOne({huntId: user.currentHunt}).exec(function(err, waypoint){
          if(!waypoint){
            console.log("ERROR: HUNT DOESN'T EXIST")
            return;
          }

          var userWaypoint = {
            id: waypoint._id,
            status: "DOING",
            targetName: ""
          };

          user.waypoints.push(userWaypoint);

          user.save(function(err){});

          PLocation.findOne({username: data.username}).sort("-time").exec(function(err, lastLocation){
            if(!lastLocation) {
              console.log("ARGGGGGGGGGGG");
              return;
            }

            getDistance(userWaypoint, lastLocation, function(dNum){
              res.send({
                type: "DISTANCE",
                distance: dNum,
                hint: userWaypoint.hint,
                isPerson: false
              });
            });
          });
        });
      });
      break;
    case "ANSWER":
      if(!data.img) {
        PUser.findOne({username: data.username}).exec(function(err, user){
          var id = user.waypoints[user.waypoints.length - 1].id;

          PWaypoint.findOne({_id: id}).exec(function(err, currentWaypoint){
            console.log("HEY: '" + data.text.toLowerCase().replace(/\s/g, '') + "'");
            console.log("HEY: '" + currentWaypoint.answer.toLowerCase().replace(/\s/g, '') + "'");

            if(data.text.toLowerCase().replace(/\s/g, '') !== currentWaypoint.answer.toLowerCase().replace(/\s/g, '')) {
              var action = new PUserLikeSomethingHeDid({
                time: data.time === 0 ? Date.now() : data.time,
                username: data.username,
                action: {
                  type: "ANSWER",
                  text: data.text,
                  answer: false,
                  image: ""
                }
              });

              action.save(function(err){});

              res.send({
                type: "ANSWER",
                answer: false,
                hint: currentWaypoint.hint,
                points: user.points
              });
            } else {
              PWaypoint.find({huntId: user.currentHunt}).exec(function(err, allWaypoints){
                PUser.find({currentHunt: user.currentHunt}).ne("username", user.username).exec(function (err, allUsers) {
                  // console.log("ALL USERS " + allUsers);
                  // console.log("ALL WAYPOINTS " + allWaypoints);

                  var random = Math.random();
                  var action = new PUserLikeSomethingHeDid({
                    time: data.time === 0 ? Date.now() : data.time,
                    username: user.username,
                    action: {
                      type: "ANSWER",
                      text: data.text,
                      answer: true,
                      image: ""
                    }
                  });

                  action.save(function(err){});
                  // console.log("YO RANDOM " + random);
                  if(allUsers.length < 2 || random > 0.0) {
                    var waypoint = assignWaypoint(allWaypoints, user, "DONE");

                    if(!waypoint) {
                      console.log("User " + user.username + " won");

                      var action = new PUserLikeSomethingHeDid({
                        time: data.time === 0 ? Date.now() : data.time,
                        username: data.username,
                        action: {
                          type: "WIN",
                          text: data.text,
                          answer: true,
                          image: ""
                        }
                      });
                      action.save(function(err){});

                      user.currentHunt = null;
                      user.waypoints = [];
                      user.save(function(){});

                      res.send({
                        type: "WIN",
                        points: user.points
                      });
                    } else {
                      PLocation.findOne({username: user.username}).sort("-time").exec(function(err, lastLocation){
                        if(!lastLocation) {
                          console.log("ARGGGGGGGGGGG333333333");
                          return;
                        }

                        getDistance(user.waypoints[user.waypoints.length - 1], lastLocation, function(dNum){
                          res.send({
                            type: "DISTANCE",
                            distance: dNum,
                            points: user.points,
                            hint: waypoint.hint,
                            isPerson: false
                          });
                        });
                      });
                    }
                  } else {
                    var userMeet = allUsers[Math.floor(random * allUsers.length)];
                    var waypoint = new PWaypoint({
                      targetName: userMeet.username ? userMeet.username : "",
                      id: -1,
                      status: "DOING"
                    });

                    userMeet.waypoints[userMeet.waypoints.length - 1].id = -1;
                    userMeet.waypoints[userMeet.waypoints.length - 1].targetName = user.username ? user.username : "";

                    user.waypoints[user.waypoints.length - 1].status = "DONE";
                    user.waypoints.push(waypoint);

                    PLocation.findOne({username: user.username}).sort("-time").exec(function(err, lastLocation){
                      if(!lastLocation) {
                        console.log("ARGGGGGGGGGGG2222222");
                        return;
                      }

                      getDistance(user.waypoints[user.waypoints.length - 1], lastLocation, function(dNum){
                        res.send({
                          type: "DISTANCE",
                          distance: dNum,
                          points: user.points,
                          hint: waypoint.hint,
                          isPerson: false
                        });
                      });
                    });
                  }
                });


              });
            }
          })
        });
      } else {
        //IMAGE STUFF HERE
      }
      break;
    case "SKIP":
      PUser.findOne({username: data.username}).exec(function(err, user){
        var currentWaypoint = user.waypoints[user.waypoints.length - 1];

        PUser.findOne({username: data.username}).exec(function(err, user){
          PWaypoint.find({huntId: user.currentHunt}).exec(function(err, allWaypoints){

            var waypoint = assignWaypoint(allWaypoints, user, "SKIPPED");
            if(!waypoint){
              console.log("User " + user.username + " won");
              var action = new PUserLikeSomethingHeDid({
                time: data.time === 0 ? Date.now() : data.time,
                username: data.username,
                action: {
                  type: "WIN",
                  text: data.text,
                  answer: true,
                  image: ""
                }
              });
              action.save(function(err){});

              user.currentHunt = null;
              user.waypoints = [];
              user.save(function(){});

              res.send({
                type: "WIN",
                points: user.points
              });
              return;
            }

            PLocation.findOne({username: user.username}).sort("-time").exec(function(err, lastLocation){
              if(!lastLocation) {
                console.log("ARGGGGGGGGGGG2222222");
                return;
              }

              var action = new PUserLikeSomethingHeDid({
                time: data.time === 0 ? Date.now() : data.time,
                username: data.username,
                action: {
                  type: "SKIP",
                  text: data.text,
                  answer: true,
                  image: ""
                }
              });
              action.save(function(err){});

              getDistance(user.waypoints[user.waypoints.length - 1], lastLocation, function(dNum){
                if(dNum < 0.020) {
                  res.send({
                    type: "QUESTION",
                    text: waypoint.question,
                    hint: waypoint.hint,
                    img: ""
                  });
                  return;
                }
                res.send({
                  type: "DISTANCE",
                  distance: dNum,
                  hint: waypoint.hint
                });
              });
            });
          });
        });

      });
      break;
    case "MEETUP":
      PUser.findOne({username: data.username}).exec(function(err, user){
        var otherUserName = user.waypoints[user.waypoints.length - 1].targetName;

        PUser.findOne({username: otherUserName}).exec(function(err, otherUser){
          if(otherUser.commonText.length > 0 && data.text.length > 0){
            if(otherUser.commonText.toLowerCase().replace(/\w/g, '') === data.text.toLowerCase().replace(/\w/g, '')) {
              var action = new PUserLikeSomethingHeDid({
                time: data.time === 0 ? Date.now() : data.time,
                username: data.username,
                action: {
                  type: "MEETUP",
                  text: data.text,
                  answer: true,
                  image: ""
                }
              });

              action.save(function(err){});

              res.send({
                type: "MEETUP",
                answer: true,
                hint: currentWaypoint.hint,
                points: user.points
              });
            }
          }
        });
      });
      break;
  }
});

app.get('/location', function(req, res){
  var data = req.query;

  PUser.findOne({username: data.username}).exec(function(err, user){
    if(!user) {
      var u = new PUser ({
        username: data.username,
        points: 0,
        waypoints: []
      });
      u.save(function(err){
        if(err){
          console.log("ERROR CREATING THE NEW USER");
        }
      });

      var location = new PLocation({
        time: data.time === 0 ? Date.now() : data.time,
        username: u.username,
        location: {
          latitude: parseFloat(data.latitude),
          longitude: parseFloat(data.longitude)
        }
      });

      location.save(function(err){
        if(err){
          console.log("ERROR BAFDAHFDSH:F");
        }
      });

      PHunt.find({}).exec(function(err, hunts){
        res.send({
          type: "PICK",
          picks: hunts
        });
      });
    } else {
      var location = new PLocation({
        time: data.time === 0 ? Date.now() : data.time,
        username: user.username,
        location: {
          latitude: parseFloat(data.latitude),
          longitude: parseFloat(data.longitude)
        }
      });
      // console.log(location);
      location.save(function(err){
        if(err){
          console.log("ERROR BAFDAHFDSH:F");
        }
      });
      var array = user.waypoints;

      if(array.length === 0) {
        PHunt.find({}).exec(function(err, hunts){
          res.send({
            type: "PICK",
            picks: hunts
          });
        });
      } else {
        var id = null;
        for (var i = 0; i < array.length; i++) {
          if(array[i].status === "DOING") {
            id = array[i].id;
            break;
          }
        }

        if(!id) {
          user.currentHunt = null;
          user.waypoints = [];
          user.save(function(){});

          PHunt.find({}).exec(function(err, hunts){
            res.send({
              type: "PICK",
              picks: hunts
            });
          });
          return;
        }

        var fakeW = user.waypoints[user.waypoints.length - 1];

        getDistance(fakeW, location, function(dNum){
          if(fakeW.targetName.length > 0) {
            if(dNum < 0.020) {
              res.send({
                type: "MEETUP",
                text: waypoint.question,
                hint: waypoint.hint,
                img: ""
              });
            } else {
              res.send({
                type: "DISTANCE",
                distance: dNum,
                hint: fakeW.targetName,
                isPerson: true
              });
            }
          } else {
            PWaypoint.findOne({_id: fakeW.id}).exec(function(err, waypoint){
              if(dNum < 0.020) {
                res.send({
                  type: "QUESTION",
                  text: waypoint.question,
                  hint: waypoint.hint,
                  img: ""
                });
                return;
              }

              res.send({
                type: "DISTANCE",
                distance: dNum,
                hint: waypoint.hint,
                isPerson: false
              });
            });
          }
        });
      }
    }
  });
});

app.listen(port, function() {
  console.log("Listening on " + port);
});


function getDistance(w, l, callback) {
  if(w.targetName.length > 0) {
    PLocation.findOne({username: w.targetName}).sort("-time").exec(function(err, location){
      if(!location) {
        console.log("PROBLEM!!!!!!!");
        return;
      }
        helper(location, l);
    });
  } else {
    PWaypoint.findOne({_id: w.id}).exec(function(err, waypoint){
      if(!waypoint) {
        console.log("2222PROBLEM!!!!!!! " + w.id);
        return;
      }
      helper(waypoint, l);
    });
  }

  function helper(w, l){
    var lat1 = w.location.latitude;
    var lon1 = w.location.longitude;
    var lat2 = l.location.latitude;
    var lon2 = l.location.longitude;

    var R = 6371; // km
    var dLat = (lat2-lat1) * Math.PI / 180;
    var dLon = (lon2-lon1) * Math.PI / 180;
    var lat1 = lat1 * Math.PI / 180;
    var lat2 = lat2 * Math.PI / 180;

    var sdlat = Math.sin(dLat/2);
    var sdlon = Math.sin(dLon/2);

    var a = sdlat * sdlat +
            sdlon * sdlon * Math.cos(lat1) * Math.cos(lat2);
    var ret = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    callback(ret);
  }
}

function assignWaypoint (allWaypoints, user, status) {
  var flag = false;
  var arr = allWaypoints.filter(function(val){
    for (var i = 0; i < user.waypoints.length; i++) {
      if(val._id.toString() == user.waypoints[i].id.toString()){
        return false;
      }
    }
    return true;
  });

  console.log(arr)
  console.log(allWaypoints);


  user.waypoints[user.waypoints.length - 1].status = status;
  // Just add 10 points per waypoint
  user.points += status === "DONE" ? 10 : 0;
  if(arr.length === 0) {
    user.save(function(){});
    return null;
  }

  user.waypoints.push({
    id: arr[0]._id,
    status: "DOING",
    targetName: ""
  });
  user.save();

  // console.log(user);

  return arr[0];
}
