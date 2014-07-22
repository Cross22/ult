/*jslint node: true, vars:true */
"use strict";

readFile('U7/static/faces.vga');

function readFile(filename) {
    var request = new XMLHttpRequest();
    
    request.open( 'GET', filename, true );
    request.responseType = 'arraybuffer';
    
    request.onload = function() {
        console.log("file loaded");
        parseFlxShp( request.response );
    }
    
    request.send();
}

function hex(value) {
    return '0x' + value.toString(16);
}

// File format from here:
// http://wiki.ultimacodex.com/wiki/Ultima_VII_Internal_Formats
function parseFlxShp(buffer) {
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
    var hdr= TFlxHdr.readStructs(buffer, 0, 1)[0];
    console.log('Magic1 should be 0xffff 1a00. Found: ' + hex(hdr.magic1));
    console.log('Num records in file: '+hdr.numRecords);
    // Read all record indices
    var recordIndex = TFlxRecordIndex.readStructs(buffer, 0x80, hdr.numRecords);
    for (var i=0; i<10; ++i) {
//        console.log( i + ': ' + hex(recordIndex[i].byteOffset)+ ' ' + hex(recordIndex[i].byteLength) );
//        parseShp(buffer, recordIndex[i].byteOffset);
    }
    parseShp(buffer, recordIndex[0].byteOffset);
}

function parseShp(buffer, fileOffset) {
    var totalLength         = new Uint32Array(buffer, fileOffset+ 0,1)[0];
    var firstFrameOffset    = new Uint32Array(buffer, fileOffset+ 4,1)[0];
    var numFrames = (firstFrameOffset - 4) / 4;
    var TShpHdr = Struct.create(
                                    Struct.uint32("totalLength"),
                                    Struct.array("offsetFrames", Struct.uint32(), numFrames) // relative to fileOffset
                                    );
    var frameIndex = TShpHdr.readStructs(buffer, fileOffset, 1)[0].offsetFrames;
    console.log('numFrames: '+ numFrames);
    for (var i=0; i<numFrames; ++i) {
//        console.log( i + ' frame at offset ' + hex(frameIndex[i]) );
//        parseSpanDescription(buffer, fileOffset+frameIndex[i]);
    }
        parseSpanDescription(buffer, fileOffset+frameIndex[0]);
}

function parseSpanDescription(buffer, fileOffset)
{
    var TFrameDesc = Struct.create(
                                Struct.uint16("maxX"),
                                Struct.uint16("minXinverted"),
                                  Struct.uint16("maxY"),
                                  Struct.uint16("minYinverted")
                                );
    var frameDesc = TFrameDesc.readStructs(buffer, fileOffset, 1)[0];
    var imageWidth = frameDesc.maxX + frameDesc.minXinverted + 1;
    var imageHeight =frameDesc.maxY + frameDesc.minYinverted + 1;
    console.log( 'Span ' + (frameDesc.minXinverted*-1) + ',' + (frameDesc.minYinverted*-1)  +' / '+ (frameDesc.maxX) + ',' + frameDesc.maxY);

    var TSpan = Struct.create(
                                  Struct.uint16("blockData"),
                                  Struct.int16("x"),
                                  Struct.int16("y")
                                  );
    var readPointer=fileOffset+8;
    while (true) {
        var currSpan = TSpan.readStructs(buffer, readPointer, 1)[0]; readPointer += 6;
        if (currSpan.blockData==0)
            break;
        var blockLen = currSpan.blockData >> 1;
        var isUncompressed = (currSpan.blockData & 1) == 0;
        if (isUncompressed) {
            var data = new Uint8Array(buffer, readPointer, blockLen); readPointer += blockLen;
            //            readImage(currSpan.x, currSpan.y, data);
        } else {
            // Run Length Encoded
            var offsetX= currSpan.x;
            var endX = offsetX + BlockLength;
            
            while (offsetX < endX) {
                var RLEHeader = new Uint8Array(buffer, readPointer, 1)[0]; readPointer += 1;
                var RLELength = RLEHeader >> 1;
                var RLEuncompressed = (RLEHeader & 1)==0;
                
                if(RLEuncompressed) {
                    var data = new Uint8Array(buffer, readPointer, RLELength); readPointer += RLELength;
                    //readImage(offsetX, offsetY, data);
                } else {
                    var color = new Uint8Array(buffer, readPointer, 1)[0]; readPointer += 1;
                    var data = new Uint8Array(RLELength);
                    for (var c=0; c<RLELength; ++c) {
                        data[c]=color;
                    }
//                    readImage(offsetX, currSpan.y, data);
                }
                
                offsetX += RLELength;
            }
        }
        break;
    }
}