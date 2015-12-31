'use strict';

var OriginalBackbone = require('backbone');
var JSOG = require('jsog');
var _ = require('underscore');
var moment = require('moment');
var Promise = require('promise-polyfill');
var $ = require('jquery');

var ReactBackbone = _.clone(OriginalBackbone);

/**
 * We extend the Model to serve the following purposes:
 * 1. 'get' function can accept an attribute path that is separated by periods, e.g.
 * token.user.name gives you the attribute located at { token: { user: { name: "example-name" } } }
 *
 * 2. 'set' function can accept attribute paths that are separated by periods, e.g. token.user.name can be set via
 * the following call: model.set({ "token.user.name": "example-name" }), OR model.set("token.user.name", "example-name")
 *  NOTE: setting a nested attribute triggers a change on the nested attribute, e.g. change:token.user.name
 *  BUT will not trigger a change event on token, or token.user even if token and user objects had to be created
 *
 * 3. Parsing of results from the server is processed via JSOG.
 *
 * 4. When saving a model that does not pass validation, a promise is returned
 */
ReactBackbone.Model = (function (oldModel) {
  var oldGet = oldModel.prototype.get;
  var oldSet = oldModel.prototype.set;
  return oldModel.extend({

    // allow getting nested attributes via strings that are separated with a period
    get: function (attribute) {
      var pcs;
      // if attribute isn't a string or is a single piece, just use the old get
      if (typeof attribute !== "string" || (pcs = attribute.split(".")).length === 1) {
        return oldGet.apply(this, arguments);
      }

      var firstPc = pcs.shift();
      var val = oldGet.call(this, firstPc);

      var pc;
      while (pcs.length > 0 && typeof val !== "undefined" && val !== null) {
        pc = pcs.shift();
        if (typeof val.get === "function") {
          val = val.get(pc);
        } else {
          val = val[ pc ];
        }
      }
      return val;
    },

    // handle setting nested attributes via strings that are separated with a period
    set: function (key, val, options) {
      // defer to the OriginalBackbone version if we don't get an object or a string for the first argument
      if (typeof key !== "object" && typeof key !== "string") {
        return oldSet.apply(this, arguments);
      }

      // if key is the name of the attribute, convert to the object version of this call
      var attrHash;
      // name of attribute passed as first argument
      if (typeof key === "string") {
        attrHash = {};
        attrHash[ key ] = val;
      } else {
        // set(hash, options) called
        attrHash = key;
        options = val || {};
      }

      var silentOptions = _.extend({}, options, { silent: true });
      var triggerChange = false;

      // for each attribute we're setting
      _.each(attrHash, function (value, attribute) {
        if (typeof attribute !== "string") {
          if (typeof attribute.toString === "function") {
            attribute = attribute.toString();
          } else {
            return;
          }
        }
        var pcs = attribute.split(".");
        var firstPc = pcs.shift();
        var topLevelValue = _.clone(this.get(firstPc));

        if (pcs.length > 0) {
          var toSet = topLevelValue;
          if (typeof toSet !== "object") {
            toSet = {};
          }
          var ptr = toSet;
          var lastPtr = ptr;
          var lastSetPc = firstPc;
          while (pcs.length > 1) {
            var nextPc = pcs.shift();
            if (typeof toSet[ nextPc ] !== "object") {
              toSet[ nextPc ] = {};
            }
            lastPtr = ptr;
            lastSetPc = nextPc;
            ptr = toSet[ nextPc ];
          }
          var lastPc = pcs.shift();

          var oldVal = this.get(attribute);
          if (_.isEqual(oldVal, value)) {
            return;
          }
          triggerChange = true;

          ptr[ lastPc ] = value;

          oldSet.call(this, firstPc, toSet, silentOptions);
          this.trigger("change:" + attribute, this, value, options);
        } else {
          // setting a top level attribute
          if (_.isEqual(value, topLevelValue)) {
            return;
          }
          triggerChange = true;
          oldSet.call(this, firstPc, value, silentOptions);
          this.trigger("change:" + firstPc, this, value, options);
        }
      }, this);

      if (triggerChange) {
        this.trigger("change", this, options);
      }
      return this;
    },

    // decode all responses using JSOG
    parse: function (response, options) {
      return _.isObject(response) ? JSOG.decode(response) : response;
    },

    // failed validation methods should return a promise
    save: function (attributes, options) {
      var toReturn = oldModel.prototype.save.apply(this, arguments);
      if (toReturn === false) {
        return new Promise(function (resolve, reject) {
          reject(this, false, options);
        });
      }
      return toReturn;
    }
  });
})(OriginalBackbone.Model);

/**
 * We extend the Backbone Collection to serve the following purposes:
 * 1. Support both server side pagination and sorting
 *
 * 2. Support fetching with query parameters
 *
 * 3. Parse responses using JSOG
 */
ReactBackbone.Collection = (function (oldCollection) {
  return oldCollection.extend({
    // do not use Backbone's Model
    model: ReactBackbone.Model,

    // internal state variables
    _pageNo: 0,
    _pageSize: 20,
    _totalRecords: null,

    // query parameter names for pagination and sorting
    startParam: "start",
    countParam: "count",
    sortParam: "sort",
    sortSeparator: "|",

    // header expected in the response for the total number of records for a server collection
    totalRecordsHeader: "X-Total-Count",

    // the applied sorts
    // each sort is represented as an object with shape { attribute: string, desc: boolean }
    sorts: [],
    // the maximum size of the sorts array
    maxSorts: 3,

    // the additional query parameters to use for fetching
    params: {},

    // internal variable storing whether the server is used for sorting and pagination - determined by
    // whether the full set of records exists on the client
    server: false,

    /**
     * 'params' can be specified as an option containing an object with a list of collection parameters
     * @param options
     */
    constructor: function (options) {
      if (options) {
        _.extend(this, _.pick(options, [ "params" ]));
      }

      oldCollection.apply(this, arguments);
    },

    /**
     * Getter for whether the collection is currently server side
     * @returns {boolean}
     */
    isServerSide: function () {
      return this.server;
    },

    /**
     * Reset the parameters used to fetch the collection, can be chained
     * @returns {ReactBackbone.Collection}
     */
    resetParams: function () {
      this.params = {};
      return this;
    },

    /**
     * Remove a parameter from the params object, can be chained
     * @param key key of the parameter
     * @returns {ReactBackbone.Collection}
     */
    unsetParam: function (key) {
      if (typeof key === "string") {
        this.params = _.omit(this.params, key);
        return this;
      }
    },

    /**
     * Set a parameter or parameters into the params object, can be chained
     * @param key object with new parameters or name of the parameter to be set
     * @param value if key is a string for the parameter name, this is the value of parameter
     * @returns {ReactBackbone.Collection}
     */
    setParam: function (key, value) {
      if (typeof key === "object") {
        this.params = _.extend({}, this.params, key);
      } else if (typeof key === "string") {
        var setObj = {};
        setObj[ key ] = value;
        this.params = _.extend({}, this.params, setObj);
      }
      return this;
    },

    /**
     * Total number of records in this collection, including server side records if server side pagination is enabled
     * @returns {*}
     */
    size: function () {
      if (this.isServerSide()) {
        return (this._totalRecords !== null) ? this._totalRecords : this.models.length;
      }

      return oldCollection.prototype.size.apply(this, arguments);
    },

    /**
     * Get the page that is currently selected
     * @returns {number}
     */
    getPageNo: function () {
      return this._pageNo;
    },

    /**
     * Set the page that is currently selected, can be chained
     * @param pageNo new page
     * @returns {ReactBackbone.Collection}
     */
    setPageNo: function (pageNo) {
      this._pageNo = pageNo;
      this.validatePageNo();
      return this;
    },

    /**
     * Go back one page, if possible - can be chained
     * @returns {*|ReactBackbone.Collection}
     */
    prevPage: function () {
      return this.setPageNo(this._pageNo - 1);
    },

    /**
     * Go forward one page, if possible - can be chained
     * @returns {*|ReactBackbone.Collection}
     */
    nextPage: function () {
      return this.setPageNo(this._pageNo + 1);
    },

    /**
     * Modify the page size of the collection - can be chained
     * @param ps new page size
     * @returns {ReactBackbone.Collection}
     */
    setPageSize: function (ps) {
      this._pageSize = ps;
      return this;
    },

    /**
     * Return the page size of the collection
     * @returns {number}
     */
    getPageSize: function () {
      return this._pageSize;
    },

    /**
     * Get the number of pages
     */
    getNumPages: function () {
      return (Math.ceil(this.size() / this.getPageSize()))
    },

    /**
     * Validate the page number-it cannot exceed the number of pages and cannot be less than 0
     * @returns {ReactBackbone.Collection}
     */
    validatePageNo: function () {
      // must be a number
      if (!_.isNumber(this._pageNo) || isNaN(this._pageNo)) {
        this._pageNo = 0;
        return;
      }
      // must be an integer
      this._pageNo = Math.round(this._pageNo);
      if (this.isServerSide()) {
        if (this._totalRecords !== null) {
          this._pageNo = Math.min(Math.ceil(this._totalRecords / this._pageSize) - 1, this._pageNo);
        }
      }
      this._pageNo = Math.max(0, this._pageNo);
      return this;
    },

    /**
     * Read response headers indicating the total number of records, etc.
     * @param response server response
     * @param options ajax options
     * @returns {*}
     */
    parse: function (response, options) {
      var responseHeaderCount = (options && options.xhr && options.xhr.getResponseHeader ) ?
        parseInt(options.xhr.getResponseHeader(this.totalRecordsHeader)) : 0;
      if (!isNaN(responseHeaderCount) && responseHeaderCount > response.length) {
        this.server = true;
        this._totalRecords = Math.max(response.length, responseHeaderCount);
      } else {
        this.server = false;
        this._totalRecords = response.length;
      }
      if (_.isArray(response)) {
        var i = 0;
        _.each(response, function (onePiece) {
          if (_.isObject(onePiece)) {
            onePiece._serverSortOrder = i++;
          }
        });
      }
      // use the JSOG library to decode whatever the response is
      return _.isObject(response) ? JSOG.decode(response) : response;
    },

    /**
     * Regular fetch, but adds the parameters and sorting to the fetch data
     * @param options backbone fetch options
     * @returns {*}
     */
    fetch: function (options) {
      options = options || {};

      var dataOptions = {};
      if (options.data) {
        dataOptions = _.parseQueryString(options.data);
      }
      var params = _.extend(this.getPaginationParams(), this.getSortParams(), _.result(this, "params"), dataOptions);

      options.data = paramify(params, true);
      return oldCollection.prototype.fetch.call(this, options);
    },

    /**
     * Remove all the sorts - can be chained
     * @returns {ReactBackbone.Collection}
     */
    resetSorts: function () {
      this.sorts = [];
      return this;
    },

    /**
     * This generic comparator handles sorting by attributes of any data type, as well as server side sorting if
     * the collection is stored on the server
     */
    comparator: function (m1, m2) {
      if (this.isServerSide()) {
        // if the collection is server side, don't do any sorting
        return (m1.get("_serverSortOrder") < m2.get("_serverSortOrder")) ? -1 : 1;
      }
      if (this.sorts.length > 0) {
        for (var i = 0; i < this.sorts.length; i++) {
          var st = this.sorts[ i ];
          var attr = st.attribute;
          var desc = (st.desc) ? -1 : 1;
          if (typeof attr !== "string") {
            continue;
          }
          // the actual comparison code starts here
          var m1a = m1.get(attr);
          var m2a = m2.get(attr);

          var comparison = this.compareAttributes(m1a, m2a);
          if (comparison !== 0) {
            return comparison * desc;
          }
        }
      }
      // equal at all attributes
      return 0;
    },

    /**
     * Generic comparator function that handles comparing for sorting different types of values
     */
    compareAttributes: function (attrA, attrB) {
      // check if one or the other is not defined or null
      if ((attrA === null || typeof attrA === "undefined") && (typeof attrB !== "undefined" && attrB !== null)) {
        return 1;
      }
      if ((attrB === null || typeof attrB === "undefined") && (typeof attrA !== "undefined" && attrA !== null)) {
        return -1;
      }

      if (typeof attrA === "string" && typeof attrB === "string") {
        attrA = attrA.toUpperCase();
        attrB = attrB.toUpperCase();
      }

      // if they are both numeric values, use the numeric value to compare the two
      var numA = +attrA, numB = +attrB;
      if (!isNaN(attrA) && !isNaN(attrB) && !isNaN(numA) && !isNaN(numB)) {
        attrA = numA;
        attrB = numB;
      }

      // if they are both strings that look like ISO 8601 dates
      if (typeof attrA === "string" && typeof attrB === "string") {
        var tsA = moment.utc(attrA, moment.ISO_8601),
          tsB = moment.utc(attrB, moment.ISO_8601);
        if (tsA.isValid() && tsB.isValid()) {
          attrA = tsA.unix();
          attrB = tsB.unix();
        }
      }

      if (attrA < attrB) {
        return -1;
      }
      if (attrB < attrA) {
        return 1;
      }
      return 0;
    },

    /**
     * Add a sort, can be chained
     * @param attribute attribute to be sorted on
     * @param desc truthy value to indicate descending
     * @returns {ReactBackbone.Collection}
     */
    addSort: function (attribute, desc) {
      if (typeof attribute !== "string") {
        return this;
      }
      this.sorts = [
        {
          attribute: attribute,
          desc: Boolean(desc)
        }
      ].concat(this.sorts);
      return this;
    },

    /**
     * Return the params object to be passed to fetch data for sorting
     * @returns {{}}
     */
    getSortParams: function () {
      var toReturn = {};
      toReturn[ this.sortParam ] = _.map(this.sorts, function (oneSort) {
        return (Boolean(oneSort.desc) ? "D" : "A") + this.sortSeparator + oneSort.attribute;
      }, this);
      return toReturn;
    },

    /**
     * Return the params object to be passed to fetch data for pagination
     * @returns {{}}
     */
    getPaginationParams: function () {
      var toReturn = {};
      toReturn[ this.startParam ] = this._pageNo * this._pageSize;
      toReturn[ this.countParam ] = this._pageSize;
      return toReturn;
    },

    /**
     * Make a PUT to the server with all the collection's contents
     * @param options
     * @returns {*}
     */
    save: function (options) {
      options = options || {};
      var oldSuccess = options.success;
      var c = this;
      return OriginalBackbone.sync("update", this, _.extend({}, options, {
        success: function (response, text, jqxhr) {
          c.set(response);
          if (typeof oldSuccess === "function") {
            oldSuccess.apply(this, arguments);
          }
          c.trigger("sync", c, response, options);
        },
        error: function (jqXhr, status, httpError) {
          c.trigger("error", c, jqXhr, options);
        }
      }));
    },

    /**
     * Extend the reset to bring us back to the first page, lose the count and change the collection to be client side
     */
    reset: function (models, options) {
      this.setPageNo(0);
      this._totalRecords = null;
      this.server = false;

      return oldCollection.prototype.reset.apply(this, arguments);
    }

  });

})(OriginalBackbone.Collection);

// With React, we have no reason to use the Backbone View
delete ReactBackbone.View;

module.exports = ReactBackbone;