var isArray = typeof Array.isArray === 'function' ? Array.isArray : function (obj) {
  return Object.prototype.toString.call(obj) === "[object Array]";
};

var nullOrUndefined = function (val) {
  return typeof val === "undefined" || val === null;
};

var JSOG_OBJECT_DECODED = '__jsogObjectDecoded';

/**
 * A custom version of JSOG's decode that can be called multiple times
 * @param encoded object to be decoded
 */
module.exports = function (encoded) {
  var doDecode, found;
  found = {};
  doDecode = function (encoded) {
    var decodeArray, decodeObject;
    decodeObject = function (encoded) {
      var id, key, ref, result, value;
      if (encoded[ JSOG_OBJECT_DECODED ] === true) {
        return encoded;
      }
      ref = encoded[ "@ref" ];
      if (ref != null) {
        ref = ref.toString();
      }
      if (ref != null) {
        return found[ ref ];
      }
      result = {};
      id = encoded[ "@id" ];
      if (id != null) {
        id = id.toString();
      }
      if (id) {
        found[ id ] = result;
      }
      for (key in encoded) {
        if (encoded.hasOwnProperty(key)) {
          value = encoded[ key ];
          if (key !== "@id") {
            result[ key ] = doDecode(value);
          }
        }
      }
      result[ JSOG_OBJECT_DECODED ] = true;
      return result;
    };
    decodeArray = function (encoded) {
      var value;
      return (function () {
        var i, len, results;
        results = [];
        for (i = 0, len = encoded.length; i < len; i++) {
          value = encoded[ i ];
          results.push(doDecode(value));
        }
        return results;
      })();
    };
    if (nullOrUndefined(encoded)) {
      return encoded;
    } else if (isArray(encoded)) {
      return decodeArray(encoded);
    } else if (typeof encoded === "object") {
      return decodeObject(encoded);
    } else {
      return encoded;
    }
  };
  return doDecode(encoded);
};