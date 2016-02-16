var Backbone = require('./index.js');
var _ = require("underscore");
var assert = require('assert');

describe('Model', function () {
  describe('#get() and #set()', function () {
    var model = new Backbone.Model();
    it('should return undefined on getting an empty attribute', function () {
      assert(typeof model.get("someundefinedattribute") === "undefined", 'undefined attribute');
    });

    it('should have the same get and set behavior as before', function () {
      model.set("test", "abc");
      model.set("green", 1);
      model.set({
        more: "attributes",
        array: [
          "test"
        ]
      });

      assert(model.get("test") === "abc");
      assert(model.get("green") === 1);
      assert(model.get("more") === "attributes");
      assert(_.isEqual(model.get("array"), [ "test" ]));
    });

    it('should support nested sets', function () {
      model.set("test.attribute", "abc");
      assert(_.isEqual(model.get("test"), { attribute: "abc" }));

      model.set("empty.attribute.array", [ "abc" ]);
      assert(_.isEqual(model.get("empty"), { attribute: { array: [ "abc" ] } }));
    });


    it('should support nested gets', function () {
      model.set("test.attribute.again", "abc");
      assert(_.isEqual(model.get("test.attribute.again"), "abc"));

      model.set("get.this.attribute", [ 'me' ]);
      assert(_.isEqual(model.get("get.this.attribute"), [ 'me' ]));
    });


    it('should not reuse objects when setting nested fields', function () {
      model.set('abc.my.fake.attribute', 'a');
      var obj = model.get('abc.my.fake');
      assert(obj.attribute === 'a');

      model.set('abc.my.fake.attribute', 'b');
      assert(obj.attribute === 'a');
      assert(model.get('abc.my.fake.attribute') === 'b');
    });

    it('should emit events for setting nested fields', function (done) {
      var eventName = 'change:my.nested.field';

      var lfn = function(){
        Backbone.stopListening(model, eventName, lfn);
        done();
      };

      Backbone.listenTo(model, eventName, lfn);

      model.set('my.nested.field', 'changed');
    });

  });
});

describe("#parse()", function () {
  it('should use JSOG to parse models and collections', function () {
    // a model with two attributes that are of the same type
    var m = new Backbone.Model({
      one: {
        "@id": "1",
        name: "hello"
      },
      two: {
        "@ref": "1"
      }
    }, { parse: true });

    assert(m.get("two.name") === "hello");

    // a circular collection
    var santas = new Backbone.Collection([
      {
        "@id": "1",
        "id": 1,
        "name": "Sally",
        "secretSanta": {
          "@id": "2",
          "id": 2,
          "name": "Bob",
          "secretSanta": {
            "@id": "3",
            "id": 3,
            "name": "Fred",
            "secretSanta": { "@ref": "1" }
          }
        }
      },
      { "@ref": "2" },
      { "@ref": "3" }
    ], { parse: true });

    assert(santas.get(2).get("secretSanta.secretSanta.name") === "Sally");
  });
});


describe('#save() invalid model', function () {
  it('should return a promise', function () {
    var m = new (Backbone.Model.extend({
      validate: function (attributes, option) {
        if (attributes.name === "Sally") {
          return "Sally is a reserved name.";
        }
      }
    }))({
      name: 'Sally'
    });

    var p = m.save();
    assert(typeof p.then === "function");
  });
});