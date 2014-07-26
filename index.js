/*jslint node: true, vars:true */
"use strict";

var ctx ;

var FACES_VGA='U7/STATIC/FACES.VGA';
var PALETTES_FLX='U7/STATIC/PALETTES.FLX';

//-----------------------------------------------------------------------------------------------------------------
// Make a hex string out of value
function hex(value) {
    return '0x' + value.toString(16);
}

//-----------------------------------------------------------------------------------------------------------------
// FLX is the basic container file format of U7. FlxParser is a base class that reads the table of contents
// File format from here:
// http://wiki.ultimacodex.com/wiki/Ultima_VII_Internal_Formats
function  FlxParser() {
    // SomeSuperClass.apply(this, Array.prototype.slice.call(arguments));
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
//    console.log('Magic1 should be 0xffff 1a00. Found: ' + hex(hdr.magic1));
    console.log('Num records in file: '+hdr.numRecords);
    // Read all record indices
    var recordIndex = TFlxRecordIndex.readStructs(this.buffer, 0x80, hdr.numRecords);
    this.onRecordRead(recordIndex[recordNum].byteOffset);
}

FlxParser.prototype.sendRequest= function (filename, recordNum) {
    var request = new XMLHttpRequest();

    request.open( 'GET', filename, true );
    request.responseType = 'arraybuffer';

    var self=this;
    request.onload = function() {
        console.log("file loaded: "+filename);
        self.buffer= request.response;
        self.parse( recordNum  );
    }

    request.send();
}


// Load file and then call onRecordRead(arrayBuffer, byteOffset) once recordNum has been read
FlxParser.prototype.readFile= function (filename, recordNum, onRecordRead ) {
    this.onRecordRead = onRecordRead;
    this.sendRequest(filename, recordNum);
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
    
    var imageWidth = right -left + 1;
    var imageHeight =bottom - top +1;
    
    this.currImg =    ctx.createImageData(imageWidth, imageHeight);
    this.currImgData= this.currImg.data;
    this.indexedData= new Array(imageWidth*imageHeight);
}
// store span in indexed data buffer
RGBAImage.prototype.setSpan= function(x, y, data) {
    x+= -this.imgLeft; y+= -this.imgTop;
    var indexPtr= (x+y*this.currImg.width);
    for (var i=0; i<data.length; ++i) {
        var color= data[i];
        if (color==0xff) { // 0xff is transparent
            indexPtr++;
            continue;
        } else {
            this.indexedData[indexPtr++]= data[i];
        }
    }
}
// convert indexed data to RGBA buffer
RGBAImage.prototype.applyPalette= function(palette) {
    var len= this.indexedData.length;
    var pixelPtr=0;
    for (var i=0; i<len; ++i) {
        // read from indexed data and get rgb values
        var color= palette[this.indexedData[i]];
        if (color===undefined) {
            //alpha=0
            this.currImgData[pixelPtr+3]= 0;
            pixelPtr+=4;
            continue;
        }
        this.currImgData[pixelPtr++]= color.r;
        this.currImgData[pixelPtr++]= color.g;
        this.currImgData[pixelPtr++]= color.b;
        this.currImgData[pixelPtr++]= 0xff;
    }
}
RGBAImage.prototype.blitImage= function(x,y) {
    ctx.putImageData(this.currImg, x,y);
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

PaletteParser.prototype.parsePalette= function (fileOffset) {
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
    this.onload= function(rgbaImage) {}
}
ShapeParser.prototype= new FlxParser();

// Load file and then call onRecordRead(arrayBuffer, byteOffset) once recordNum has been read
ShapeParser.prototype.readFile= function (filename, recordNum, frameNum) {
    this.onRecordRead = function(fileOffset){ this.parseFrameIndex(fileOffset, frameNum); }
    this.sendRequest(filename, recordNum);
}

ShapeParser.prototype.parseFrameIndex= function (fileOffset, frameNum) {
    var TShpStart = Struct.create(
        Struct.uint32("totalLength"), // relative to beginning of flx file
        Struct.uint32("firstFrameOffset")
    );

    var shpStart = TShpStart.readStructs(this.buffer, fileOffset, 1)[0];
    var firstFrameOffset    = shpStart.firstFrameOffset;
    var numFrames = (firstFrameOffset - 4) / 4;
    var TShpHdr = Struct.create(
        Struct.uint32("totalLength"),
        Struct.array("offsetFrames", Struct.uint32(), numFrames) // relative to fileOffset
    );
    var frameIndex = TShpHdr.readStructs(this.buffer, fileOffset, 1)[0].offsetFrames;
    console.log('numFrames: '+ numFrames);
    if (frameNum>=numFrames) {
        console.log('frame request exceeded numFrames');
        frameNum= numFrames-1;
    }
    this.parseShapeFrame(fileOffset+frameIndex[frameNum]);
}

ShapeParser.prototype.parseShapeFrame= function (fileOffset)
{
    var TFrameDesc = Struct.create(
        Struct.uint16("maxX"),
        Struct.uint16("minXinverted"),
        Struct.uint16("minYinverted"),
        Struct.uint16("maxY")
    );
    var frameDesc = TFrameDesc.readStructs(this.buffer, fileOffset, 1)[0];
    var rgbaImage= new RGBAImage(-frameDesc.minXinverted, -frameDesc.minYinverted, frameDesc.maxX, frameDesc.maxY);

    console.log( 'Frame ' + (frameDesc.minXinverted*-1) + ',' + (frameDesc.minYinverted*-1)  +' / '+ (frameDesc.maxX) + ',' + frameDesc.maxY);

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
    
    this.onload(rgbaImage);
}


//-----------------------------------------------------------------------------------------------------------------
// current shape record to read. There are 300 in faces.vga
var currFace= 0;
var MAX_FACE= 5;
var intervalId;

// We just need one flx parser here
var palParser = new PaletteParser();
var shpParser = new ShapeParser();

var arrFaceImages = new Array(MAX_FACE);

function drawFaces() {
    currFace=0;
    intervalId=setInterval( function(){
                           if (currFace<MAX_FACE)
                            arrFaceImages[currFace++].blitImage(0,0);
                           else
                            clearInterval(intervalId);
                           
                           },500);
}

function loadFaces(palette) {
    // Load faces async
    shpParser.onload= function(rgbaImage) {
        rgbaImage.applyPalette(palette);
        arrFaceImages[currFace++]=rgbaImage;
        if (currFace>=MAX_FACE)
            drawFaces();
    }
    
    var frame=1; // some shapes have multiple frames/expressions
    for (var record=0; record<MAX_FACE; ++record) {
        shpParser.readFile(FACES_VGA, record, frame);
    }
}

window.onload=function(){
    var canvas = document.getElementById("mycanvas");
    ctx = canvas.getContext("2d");

    // Load Palette #0 first
    var palette; // has rg,b, fields
    palParser.onload= function(pal) {
        palette=pal;
        loadFaces(palette);
    }
    palParser.readFile(PALETTES_FLX, 0);
};

