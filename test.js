var Backbone = require('./index.js');
var _ = require("underscore");
var assert = require('assert');

describe('Model', function () {
  describe('#get()', function () {
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

  });
});