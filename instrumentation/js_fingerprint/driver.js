'use strict';

const Wappalyzer = require('./wappalyzer');
const request = require('request');
const url = require('url');
const fs = require('fs');
const Browser = require('zombie');
const Timer = require('timers');
const setIntervalmine = Timer.setInterval;

const json = JSON.parse(fs.readFileSync(__dirname + '/apps.json'));

const extensions = /^([^.]+$|\.(asp|aspx|cgi|htm|html|jsp|php)$)/;

class Driver {
  constructor(pageUrl, options) {
    this.options = Object.assign({}, {
      debug: false,
      delay: 500,
      maxDepth: 3,
      maxUrls: 10,
      maxWait: 5000,
      recursive: false,
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36',
    }, options || {});

    this.options.debug = Boolean(this.options.debug);
    this.options.delay = this.options.recursive ? parseInt(this.options.delay, 10) : 0;
    this.options.maxDepth = parseInt(this.options.maxDepth, 10);
    this.options.maxUrls = parseInt(this.options.maxUrls, 10);
    this.options.maxWait = parseInt(this.options.maxWait, 10);
    this.options.recursive = Boolean(this.options.recursive);

    this.origPageUrl = url.parse(pageUrl);
    this.analyzedPageUrls = [];
    this.apps = [];
    this.meta = {};

    this.wappalyzer = new Wappalyzer();

    this.wappalyzer.apps = json.apps;
    this.wappalyzer.categories = json.categories;

    this.wappalyzer.parseJsPatterns();
    //console.log("we are in driver before (message,source,type)");
    this.wappalyzer.driver.log = (message, source, type) => this.log(message, source, type);
    this.wappalyzer.driver.displayApps = (detected, meta, context) => this.displayApps(detected, meta, context);
  }

  analyze() {
    this.time = {
      start: new Date().getTime(),
      last: new Date().getTime(),
    }

      return this.crawl(this.origPageUrl);
  }

  log(message, source, type) {
    this.options.debug && console.log('[Sentinel ' + type + ']', '[' + source + ']', message);
  }

  displayApps(detected, meta) {
    this.meta = meta;

    Object.keys(detected).forEach(appName => {
      const app = detected[appName];

      var categories = [];

      app.props.cats.forEach(id => {
        var category = {};

        category[id] = json.categories[id].name;

        categories.push(category)
      });

      if ( !this.apps.some(detectedApp => detectedApp.name === app.name) ) {
        this.apps.push({
          name: app.name,
          confidence: app.confidenceTotal.toString(),
          version: app.version,
          icon: app.props.icon || 'default.svg',
          website: app.props.website,
          categories
        });
      }
    });
  }

  fetch(pageUrl, index, depth) {
    //console.log("we are in fetech");
    // Return when the URL is a duplicate or maxUrls has been reached
    if ( this.analyzedPageUrls.indexOf(pageUrl.href) !== -1 || this.analyzedPageUrls.length >= this.options.maxUrls ) {
      return Promise.resolve();
    }

    this.analyzedPageUrls.push(pageUrl.href);

    const timerScope = {
      last: new Date().getTime()
    };
    this.timer('fetch; url: ' + pageUrl.href + '; depth: ' + depth + '; delay: ' + ( this.options.delay * index ) + 'ms', timerScope);
    //console.log('we finished the fetch');
    return new Promise(resolve => this.sleep(this.options.delay * index).then(() => this.visit(pageUrl, timerScope, resolve)));
    
  }

  visit(pageUrl, timerScope, resolve) {

      const browser = new Browser({
      silent: true,
      userAgent: this.options.userAgent,
      waitDuration: this.options.maxWait,
    });

    this.timer('browser.visit start; url: ' + pageUrl.href, timerScope);
    //console.log('we are parsing: ', pageUrl.href);
    
    browser.visit(pageUrl.href, () => {
      
      this.timer('browser.visit end; url: ' + pageUrl.href, timerScope);

      //console.log('browser.visit end; url: ' + pageUrl.href, timerScope);

      if ( !this.responseOk(browser, pageUrl) ) {
          return resolve();
         }
           
      //console.log(this.getHtml(browser));
      const headers = this.getHeaders(browser);
      const html = this.getHtml(browser);
      //console.log(html);
      const scripts = this.getScripts(browser);
      const js = this.getJs(browser);
      //console.log(scripts);
      //console.log(url.parse(scripts[0]));
      this.wappalyzer.analyze(pageUrl, {
        headers,
        html,
        scripts,
        js
      });
 
      const links = Array.from(browser.document.getElementsByTagName('a'))
        .filter(link => link.hostname === this.origPageUrl.hostname)
        .filter(link => extensions.test(link.pathname))
        .map(link => { link.hash = ''; return url.parse(link.href) });
          return resolve(links);
    });
   
  }

  responseOk(browser, pageUrl) {

       // Validate response
    const resource = browser.resources.length ? browser.resources.filter(resource => resource.response).shift() : null;

    if ( !resource ) {
      this.wappalyzer.log('No response from server; url: ' + pageUrl.href, 'driver', 'error');

      return false;
    }

    if ( resource.response.status !== 200 ) {
      this.wappalyzer.log('Response was not OK; status: ' + resource.response.status + ' ' + resource.response.statusText + '; url: ' + pageUrl.href, 'driver', 'error');

      return false;
    }

    const headers = this.getHeaders(browser);

    // Validate content type
    const contentType = headers.hasOwnProperty('content-type') ? headers['content-type'].shift() : null;

    if ( !contentType || !/\btext\/html\b/.test(contentType) ) {
      this.wappalyzer.log('Skipping; url: ' + pageUrl.href + '; content type: ' + contentType, 'driver');

      this.analyzedPageUrls.splice(this.analyzedPageUrls.indexOf(pageUrl.href), 1);

      return false;
    }

    // Validate document
    if ( !browser.document || !browser.document.documentElement ) {
      this.wappalyzer.log('No HTML document; url: ' + pageUrl.href, 'driver', 'error');

      return false;
    }

    return true;
  }

  getHeaders(browser) {
    const headers = {};

    const resource = browser.resources.length ? browser.resources.filter(resource => resource.response).shift() : null;

    if ( resource ) {
      resource.response.headers._headers.forEach(header => {
        if ( !headers[header[0]] ){
          headers[header[0]] = [];
        }

        headers[header[0]].push(header[1]);
      });
    }
    //console.log(headers);
    return headers;
  }

  getHtml(browser) {
    let html = '';

    try {
      html = browser.html();

      if ( html.length > 50000 ) {
        html = html.substring(0, 25000) + html.substring(html.length - 25000, html.length);
      }
    } catch ( error ) {
      this.wappalyzer.log(error.message, 'browser', 'error');
    }

    return html;
  }

  getScripts(browser) {
    if ( !browser.document || !browser.document.scripts ) {
      return [];
    }

    const scripts = Array.prototype.slice
      .apply(browser.document.scripts)
      .filter(script => script.src)
      .map(script => script.src);

    return scripts;
  }

  getJs(browser) {
    const patterns = this.wappalyzer.jsPatterns;
    const js = {};

    Object.keys(patterns).forEach(appName => {
      js[appName] = {};

      Object.keys(patterns[appName]).forEach(chain => {
        js[appName][chain] = {};

        patterns[appName][chain].forEach((pattern, index) => {
          const properties = chain.split('.');

          let value = properties.reduce((parent, property) => {
            return parent && parent.hasOwnProperty(property) ? parent[property] : null;
          }, browser.window);

          value = typeof value === 'string' ? value : !!value;

          if ( value ) {
            js[appName][chain][index] = value;
          }
        });
      });
    });

    return js;
  }


  crawl(pageUrl, index = 1, depth = 1) {
    //console.log('we are in the crawl');
    pageUrl.canonical = pageUrl.protocol + '//' + pageUrl.host + pageUrl.pathname;
    return new Promise(resolve => {
      this.fetch(pageUrl, index, depth)
      //setInterval(function mycrush(){
     //   console.log('man hamon yeki hjastam');}(),10000)
        .then(links => {
                  
          if ( links && Boolean(this.options.recursive) && depth < this.options.maxDepth ) {

            //console.log('we are in then of fetch in crawl');
            
            return Promise.all(links.map((link, index) => this.crawl(link, index + 1, depth + 1)));
            
          } else {
            return Promise.resolve();
          }
        })
        .then(() => {
            resolve({
            urls: this.analyzedPageUrls,
            applications: this.apps,
            meta: this.meta
          });
        });
    });
  }

  sleep(ms) {
    return ms ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
  }

  timer(message, scope) {
    const time = new Date().getTime();
    const sinceStart = ( Math.round(( time - this.time.start ) / 10) / 100) + 's';
    const sinceLast = ( Math.round(( time - scope.last ) / 10) / 100) + 's';

    this.wappalyzer.log('[timer] ' + message + '; lapsed: ' + sinceLast + ' / ' + sinceStart, 'driver');

    scope.last = time;
  }
};

module.exports = Driver;
