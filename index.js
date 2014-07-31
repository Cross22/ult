/*jslint node: true, vars:true */
"use strict";

var ctx ;
var ctximagedata;

// 8x8 Tiles: 0..149,
// Regular shapes: 150..1000, excluding: 153,158,159,160,161,168,186,187,194 and several others
var U7MAP='U7/STATIC/U7MAP';
var U7CHUNKS='U7/STATIC/U7CHUNKS';
var SHAPES_VGA='U7/STATIC/SHAPES.VGA';
var FACES_VGA='U7/STATIC/FACES.VGA';   //0..292
var PALETTES_FLX='U7/STATIC/PALETTES.FLX';
var TFA_DAT='U7/STATIC/TFA.DAT';

//-----------------------------------------------------------------------------------------------------------------
// Make a hex string out of value
function hex(value) {
    return '0x' + value.toString(16);
}

//-----------------------------------------------------------------------------------------------------------------
// FLX is the basic container file format of U7. FlxParser is a base class that reads the table of contents
// File format from here:
// http://wiki.ultimacodex.com/wiki/Ultima_VII_Internal_Formats
// For details on map record entries, look here:
// http://bootstrike.com/Ultima/Online/editu7.php
function  FlxParser() {
}
FlxParser.prototype.parse= function(recordNum)
{
    var TFlxHdr = Struct.create(
                                Struct.string("comment",80),
                                Struct.uint32("magic1"),
                                Struct.uint32("numRecords"),
                                Struct.array("magic2", Struct.uint32(),10)
                                );
    var TFlxRecordIndex = Struct.create(
                                        Struct.uint32("byteOffset"), // relative to beginning of flx file
                                        Struct.uint32("byteLength")
                                        );
    var hdr= TFlxHdr.readStructs(this.buffer, 0, 1)[0];
    if (hdr.magic1!=0xffff1a00) {
        console.log('Magic1 is not 0xffff 1a00. Found: ' + hex(hdr.magic1));
        return;
    }
    //    console.log('Num records in file: '+hdr.numRecords);
    // Read all record indices
    var recordIndex = TFlxRecordIndex.readStructs(this.buffer, 0x80, hdr.numRecords);
    this.onRecordRead(recordIndex[recordNum].byteOffset,recordIndex[recordNum].byteLength);
}

FlxParser.prototype.sendRequest= function (filename, recordNum) {
    // do we need to read the file first?
    if (this.buffer===undefined)
    {
        var request = new XMLHttpRequest();
        
        request.open( 'GET', filename, true );
        request.responseType = 'arraybuffer';
        
        var self=this;
        request.onload = function() {
            //            console.log("file loaded: "+filename);
            self.buffer= request.response;
            self.parse( recordNum  );
        }
        request.send();
    } else {
        // file is already loaded. reuse buffer
        this.parse( recordNum  );
    }
}


// Load file and then call onRecordRead(arrayBuffer, byteOffset) once recordNum has been read
FlxParser.prototype.readFile= function (filename, recordNum, onRecordRead ) {
    this.onRecordRead = onRecordRead;
    this.sendRequest(filename, recordNum);
}

//---------------------------------------------------------------------------
// ShapeFlagReader - gets extended information about renderable shapes
// Stored in 24bits: http://wiki.ultimacodex.com/wiki/Ultima_VII_Internal_Formats#aWorldShapes
function  ShapeFlagReader() {
}
ShapeFlagReader.prototype.getAttribs= function(recordNum)
{
    var TfaFlags = Struct.create(
                                        Struct.uint8("a"),
                                        Struct.uint8("b"),
                                        Struct.uint8("c")
                                        );
    var flags = TfaFlags.readStructs(this.buffer, 3*recordNum, 1)[0];
    // make it human-readable and pass back to caller
    var attribs= {
        "unknown": flags.a & 1,
        "rotatable": flags.a & 2,
        "animated" : flags.a & 4,
        "obstacle" : flags.a & 8,
        "water" : flags.a & 0x10,
        "tileZ" : (flags.a >> 5) & 7,
        "type"  : flags.b & 15,
        "itsatrap" : flags.b & 0x10,
        "door" : flags.b & 0x20,
        "vehicle" : flags.b & 0x40,
        "unselectable" : flags.b & 0x80,
        "tileXminusOne" : (flags.c & 7),
        "tileYminusOne" : (flags.c>>3) & 7,
        "lightSource" : flags.c & 0x40,
        "translucent" : flags.c & 0x80 };
    return attribs;
}

// Load file and then call onRecordRead(arrayBuffer, byteOffset) once recordNum has been read
// onRecordRead( recordNum, attrib );
ShapeFlagReader.prototype.init= function ( onLoaded ) {
    var request = new XMLHttpRequest();
    
    request.open( 'GET', TFA_DAT, true );
    request.responseType = 'arraybuffer';
    
    var self=this;
    request.onload = function() {
        self.buffer= request.response;
        onLoaded();
    }
    request.send();
}


//-----------------------------------------------------------------------------------------------------------------
// A simple image object that can be blitted later. Uses gPalette to map from indexed to RGBA
function  RGBAImage(left,top,right,bottom) {
    // SomeSuperClass.apply(this, Array.prototype.slice.call(arguments));
    // this.memberVar= "abc";
    this.imgLeft=left;
    this.imgRight=right;
    this.imgTop=top;
    this.imgBottom=bottom;
    
    this.width = right -left + 1;
    this.height =bottom - top +1;
    // check for illegal values
    if (this.width>320||this.height>200) {
        return null;
    }
    this.indexedData= new Array(this.width*this.height);
}

// store span in indexed data buffer
RGBAImage.prototype.setSpan= function(x, y, data) {
    x+= -this.imgLeft; y+= -this.imgTop;
    var indexPtr= (x+y*this.width);
    for (var i=0; i<data.length; ++i) {
        var color= data[i];
        if (color===0xff) { // 0xff is transparent
            ++indexPtr;
            continue;
        } else {
            this.indexedData[indexPtr++]= color;
        }
    }
}

RGBAImage.prototype.blitImage= function(x,y) {
    var w=this.width;
    var h=this.height;
    
    var leftScreen=x+this.imgLeft;
    var rightScreen=leftScreen+w;
    var topScreen=y+this.imgTop;
    var bottomScreen=topScreen+h;

    // entirely outside
    if (rightScreen < 0) return;
    if (leftScreen >= 320) return;
    if (bottomScreen < 0) return;
    if (topScreen >= 200) return;
    
    var data = ctximagedata.data;
    var sourcedata= this.indexedData;
    // we might exceed canvas bounds- find overlap to clip
    var maxx= w;
    var maxy= h;
    var minx= 0, miny=0;
    if (leftScreen<0)
        minx -= leftScreen;
    if (topScreen<0)
        miny -= topScreen;
    if (rightScreen>=320)
        maxx -= (rightScreen-320);
    if (bottomScreen>=200)
        maxy -= (bottomScreen-200);
    
    var outy=(miny+y+this.imgTop)*320;
    for (var sy=miny; sy<maxy;++sy) {
        for (var sx=minx; sx<maxx;++sx)
        {
            var outx=(sx+x+this.imgLeft);
            var outptr= (outy+outx)<<2;
            
            var inptr= (sy*w+sx);
            
            var color= world.palette[sourcedata[inptr]];
            if (color===undefined) {
                //alpha=0
                continue;
            }
            data[outptr]= color.r;
            data[outptr+1]= color.g;
            data[outptr+2]= color.b;
            data[outptr+3]= 0xff;
            outptr+=4;
        }
        outy+=320;
    }
}

//-----------------------------------------------------------------------------------------------------------------
// Palette parsing
function  PaletteParser() {
    FlxParser.apply(this, Array.prototype.slice.call(arguments));
    this.onload= function(palette) {}
    this.onRecordRead = this.parsePalette;
}
PaletteParser.prototype= new FlxParser();

// Load file and set palette to palette stored in recordnum
PaletteParser.prototype.readFile= function (filename, recordNum ) {
    this.sendRequest(filename, recordNum);
}

PaletteParser.prototype.parsePalette= function (fileOffset,byteLength) {
    var TColorEntry = Struct.create(
                                    Struct.uint8("r"),
                                    Struct.uint8("g"),
                                    Struct.uint8("b")
                                    );
    var pal = TColorEntry.readStructs(this.buffer, fileOffset, 256);
    for (var c=0; c<pal.length; ++c)
    {
        pal[c].r <<= 2;
        pal[c].g <<= 2;
        pal[c].b <<= 2;
    }
    // there should be 11 more palettes here..
    this.onload(pal);
}


//-----------------------------------------------------------------------------------------------------------------
// Shape frame parsing
function  ShapeParser() {
    FlxParser.apply(this, Array.prototype.slice.call(arguments));
}
ShapeParser.prototype= new FlxParser();

// Load file and then call onRecordRead(arrayBuffer, byteOffset) once recordNum has been read
ShapeParser.prototype.readFile= function (filename, recordNum, frameNum, callback) {
    this.onRecordRead = function(fileOffset,byteLength){ this.parseFrameIndex(fileOffset, byteLength, frameNum, callback); }
    this.sendRequest(filename, recordNum);
}

ShapeParser.prototype.parseFrameIndex= function (fileOffset, byteLength, frameNum,callback) {
    var TShpStart = Struct.create(
                                  Struct.uint32("totalLength"),
                                  Struct.uint32("firstFrameOffset") // relative to beginning of flx file
                                  );
    
    var shpStart = TShpStart.readStructs(this.buffer, fileOffset, 1)[0];
    // A default shaper header has the expected length. extended headers will have a different length listed here
    if (shpStart.totalLength==byteLength) {
        var firstFrameOffset    = shpStart.firstFrameOffset;
        var numFrames = (firstFrameOffset - 4) / 4;
        var TShpHdr = Struct.create(
                                    Struct.uint32("totalLength"),
                                    Struct.array("offsetFrames", Struct.uint32(), numFrames) // relative to fileOffset
                                    );
        var frameIndex = TShpHdr.readStructs(this.buffer, fileOffset, 1)[0].offsetFrames;
        //        console.log('numFrames: '+ numFrames);
        if (frameNum>=numFrames) {
            console.log('frame request exceeded numFrames');
            frameNum= numFrames-1;
        }
        this.parseShapeFrame(fileOffset+frameIndex[frameNum], callback);
    } else {
        // raw data, no frame header for 8x8 fixed ground tiles
        var LEN= 8*8;
        var numFrames= byteLength / LEN;
        //        console.log('raw data, no frame header');
        var rgbaImage= new RGBAImage(-7,-7,0,0); // ground tile default size
        if (frameNum>=numFrames) {
            console.log('frame request exceeded numFrames');
            frameNum= numFrames-1;
        }
        var readPointer=fileOffset + LEN* frameNum;
        var data = new Uint8Array(this.buffer, readPointer, LEN);
        rgbaImage.setSpan(-7, -7, data);
        callback(rgbaImage);
    }
}

ShapeParser.prototype.parseShapeFrame= function (fileOffset, callback)
{
    var TFrameDesc = Struct.create(
                                   Struct.uint16("maxX"),
                                   Struct.uint16("minXinverted"),
                                   Struct.uint16("minYinverted"),
                                   Struct.uint16("maxY")
                                   );
    var frameDesc = TFrameDesc.readStructs(this.buffer, fileOffset, 1)[0];
    var rgbaImage= new RGBAImage(-frameDesc.minXinverted, -frameDesc.minYinverted, frameDesc.maxX, frameDesc.maxY);
    
    //    console.log( 'Frame ' + (frameDesc.minXinverted*-1) + ',' + (frameDesc.minYinverted*-1)  +' / '+ (frameDesc.maxX) + ',' + frameDesc.maxY);
    
    var TSpan = Struct.create(
                              Struct.uint16("blockData"),
                              Struct.int16("x"),
                              Struct.int16("y")
                              );
    var readPointer=fileOffset+8;
    while (true) {
        var currSpan = TSpan.readStructs(this.buffer, readPointer, 1)[0]; readPointer += 6;
        if (currSpan.blockData==0)
            break;
        var blockLen = currSpan.blockData >> 1;
        var isUncompressed = (currSpan.blockData & 1) == 0;
        if (isUncompressed) {
            var data = new Uint8Array(this.buffer, readPointer, blockLen); readPointer += blockLen;
            rgbaImage.setSpan(currSpan.x, currSpan.y, data);
        } else {
            // Run Length Encoded
            var offsetX= currSpan.x;
            var endX = offsetX + blockLen;
            
            while (offsetX < endX) {
                var RLEHeader = new Uint8Array(this.buffer, readPointer, 1)[0]; readPointer += 1;
                var RLELength = RLEHeader >> 1;
                var RLEuncompressed = (RLEHeader & 1)==0;
                
                if(RLEuncompressed) {
                    var data = new Uint8Array(this.buffer, readPointer, RLELength); readPointer += RLELength;
                    rgbaImage.setSpan(offsetX, currSpan.y, data);
                } else {
                    var color = new Uint8Array(this.buffer, readPointer, 1)[0]; readPointer += 1;
                    var data = new Uint8Array(RLELength);
                    for (var c=0; c<RLELength; ++c) {
                        data[c]=color;
                    }
                    rgbaImage.setSpan(offsetX, currSpan.y, data);
                }
                
                offsetX += RLELength;
            }
        }
    }
    
    callback(rgbaImage);
}

//-----------------------------------------------------------------------------------------------------------------
// World data
function  World() {
    this.shapeCache= new Array();
    this.shpParser = new ShapeParser();
    var self=this;
}

World.prototype.init= function (onReady) {
    // load all map data - nested async callbacks
    var self=this;
    var shapeOnload= function(rgbaimage) {
        self.readU7map(
                       function() {
                       self.readU7chunks( onReady );
                       }
                       );
    };
    
    // start with dummy shape
    this.getShape(0,0, shapeOnload);
}

World.prototype.readU7map= function (onLoaded) {
    var request = new XMLHttpRequest();
    
    request.open( 'GET', U7MAP, true );
    request.responseType = 'arraybuffer';
    
    var self=this;
    request.onload = function() {
        self.u7mapBuffer= request.response;
        if (self.u7mapBuffer===undefined) {
            console.log('READ ERROR FOR U7MAP');
            return;
        }
        onLoaded();
    }
    request.send();
}

World.prototype.readU7chunks= function (onLoaded) {
    var request = new XMLHttpRequest();
    
    request.open( 'GET', U7CHUNKS, true );
    request.responseType = 'arraybuffer';
    
    var self=this;
    request.onload = function() {
        self.u7chunksBuffer= request.response;
        if (self.u7chunksBuffer===undefined) {
            console.log('READ ERROR FOR u7chunksBuffer');
            return;
        }
        // go back to caller and try parsing again
        onLoaded();
    }
    request.send();
}

World.prototype.getWorldRegion= function(worldx,worldy)
{
    // 12x12 regions in u7map
    var regionNum= worldy*12 + worldx;
    // each region has 16x16 chunk IDs
    var regionData = new Uint16Array(this.u7mapBuffer, regionNum*512, 16*16); // each uint is a chunk ID (0..0xC00)
    return regionData;
}

World.prototype.getChunk= function(chunkNum)
{
    // one chunk has 16x16 base tiles. each UINT16 contains shapeNum and frameNum
    // Bits: X FFFFF SSSSSSSSSS, where F= frameNum, S= shapeNum
    var chunkData = new Uint16Array(this.u7chunksBuffer, chunkNum*512, 16*16);
    return chunkData;
}

World.prototype.getShape= function(shapeNum,frameNum,onLoad)
{
    this.shpParser.readFile(SHAPES_VGA, shapeNum, frameNum, onLoad);
}

World.prototype.getShapeFrame= function(shapeFrame,onLoad)
{
    var cached= this.shapeCache[shapeFrame];
    if (cached===undefined) {
        var self=this;
        
        var shape= shapeFrame & 0x3FF;
        var frame= (shapeFrame>>10) & 0x1F;
        // beach is shape 1022
//        if (shape<1022) return;
        var attribs= shapeFlagReader.getAttribs(shape);
        
        this.shpParser.readFile(SHAPES_VGA, shape, frame,
                                function (img) {
                                self.shapeCache[shapeFrame]=img; // cache for next time
                                onLoad(img);
                                });
    } else {
        onLoad(cached);
    }
}


//-----------------------------------------------------------------------------------------------------------------
// MAIN()
// current shape record to read.
var currShape;
var MIN_RECORD = 116;
var MAX_RECORD= MIN_RECORD+5;
var intervalId;
var renderWorldTimer;

// We just need one flx parser here
var palParser = new PaletteParser();
//var shpParser = new ShapeParser();
var arrImages = new Array(MAX_RECORD);

var shapeFlagReader= new ShapeFlagReader();
/*
function drawShapes(palette) {
    intervalId=setInterval( function(){
                           animatePalette(palette);
                           var x=0;
                           for (var currShape=MIN_RECORD; currShape<MAX_RECORD; ++currShape) {
                           var img= arrImages[currShape];
                           if (img) {
                           img.applyPalette(palette);
                           
                           img.blitImage(x,0);
                           x+=img.buffer.canvas.width;
                           }
                           }
                           },100);
}
*/
function shiftPalette(palette, minRange, maxRange)
{
    var saved= palette[maxRange];
    for (var i=maxRange; i>minRange; --i) {
        palette[i]= palette[i-1]; // shift up
    }
    palette[minRange]=saved;
}
// some sections of the color palette get shiftled every 100ms
function animatePalette(palette) {
    shiftPalette(palette,224,231);
    shiftPalette(palette,232,239);
    shiftPalette(palette,240,243);
    shiftPalette(palette,244,247);
    shiftPalette(palette,248,251);
    shiftPalette(palette,252,254);
}
/*
function loadFaces(palette) {
    var filename= FACES_VGA;
    var frame=0; // some shapes have multiple frames/expressions
    currShape=MIN_RECORD;
    
    shpParser.onload= function(rgbaImage) {
        if (rgbaImage) {
            //            rgbaImage.applyPalette(palette);
            arrImages[currShape]=rgbaImage;
        }
        if (++currShape>=MAX_RECORD)
            drawShapes(palette);
        else
            shpParser.readFile(filename, currShape, frame);
    }
    
    shpParser.readFile(filename, currShape, frame);
}

function loadShapes(palette) {
    var filename= SHAPES_VGA;
    var frame=0; // some shapes have multiple frames/expressions
    currShape=MIN_RECORD;
    
    shpParser.onload= function(rgbaImage) {
        if (rgbaImage) {
            rgbaImage.applyPalette(palette);
            arrImages[currShape]=rgbaImage;
        }
        if (++currShape>=MAX_RECORD)
            drawShapes(palette);
        else
            shpParser.readFile(filename, currShape, frame);
    }
    
    shpParser.readFile(filename, currShape, frame);
}
*/
var world= new World();
var regionX=4, regionY=6; // (3,5) is britannia, (4,6) is beach
var chunkTop=1, chunkLeft=0;
var currentPalNum=0;

// world files in memory
function renderWorld()
{
    var region= world.getWorldRegion( regionX,regionY );
    for (var chunky=chunkTop; chunky<chunkTop+2; ++chunky) {
        for (var chunkx=chunkLeft; chunkx<chunkLeft+3; ++chunkx) {
            var xoffs=(chunkx-chunkLeft)*16*8;
            var yoffs=(chunky-chunkTop)*16*8;
            var chunkdata= world.getChunk(region[chunky*16+chunkx]);
            for (var y=0; y<16; ++y) {
                for (var x=0; x<16; ++x) {
                    var shapeFrame= chunkdata[x+y*16];
                    
                    world.getShapeFrame(shapeFrame,function(img)
                                        {
                                        if (img!==undefined) {
                                        img.blitImage(xoffs+ x*8,yoffs+ y*8);
                                        }
                                        });
                } //x
            }//y
        }//chunkx
    }//chunky
    ctx.putImageData(ctximagedata, 0, 0);
    renderWorldTimer=setTimeout( function(){
                                 animatePalette(world.palette);
                                 renderWorld();
                           },100);

}

var worldInitialized= false;
function onPaletteLoaded(pal)
{
    world.palette= pal;
    if (!worldInitialized)
    {
        worldInitialized= true;
        shapeFlagReader.init(function() { }); // TODO: Make proper initialization
        world.init(renderWorld);
    }
    //    loadFaces(pal);
    //        loadShapes(pal);
}

function loadPalette(palNum) {
    palParser.onload= onPaletteLoaded;
    palParser.readFile(PALETTES_FLX, palNum);
}

// Move chunk base with WASD keys
function onKeyDown(event) {
    event = event || window.event;
    var e = event.keyCode;
    var dirty=false;
    if (e==87 /*w*/){
        if (chunkTop>0) { --chunkTop; dirty=true; }
    } else
    
    if (e==65 /*a*/){
        if (chunkLeft>0) { --chunkLeft; dirty=true; }
    } else
    
    if (e==83 /*s*/){
        if (chunkTop<13) { ++chunkTop; dirty=true; }
    } else
    
    if (e==68 /*d*/){
        if (chunkLeft<12) { ++chunkLeft; dirty=true; }
    } if (e==80 /*p*/){
        currentPalNum= (++currentPalNum) % 12;
        loadPalette(currentPalNum);
        dirty= true;
    }
    
    if (dirty) {
        // clear pending screen refresh
        clearTimeout(renderWorldTimer);
        
        console.profile('render map');
        renderWorld();
        console.profileEnd('render map');
    }
}

window.onload=function(){
    var canvas = document.getElementById("mycanvas");
    ctx = canvas.getContext("2d");
    ctximagedata= ctx.createImageData(320,200);

    // Load Palette #0 first
    loadPalette(currentPalNum);
};

