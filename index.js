/*jslint node: true, vars:true */
"use strict";

function readFile(filename) {
    var request = new XMLHttpRequest();

    request.open( 'GET', filename, true );
    request.responseType = 'arraybuffer';

    request.onload = function() {
        parseArrayBuffer( request.response );
    }

    request.send();
}

function parseArrayBuffer(buffer) {
    // Define the struct layout
    var SimpleStruct = Struct.create(
        Struct.int8("myChar"),
        Struct.int16("myShort"),
        Struct.int32("myInt"),
        Struct.float32("myFloat")
    );

    var ComplexStruct = Struct.create(
        Struct.struct("myStruct", SimpleStruct), // Structs can be nested
        Struct.string("myString", 4),
        Struct.array("myArray", Struct.int8(), 4), // Primitives or other structs can be read as fixed-length arrays
        Struct.array("myStructArray", SimpleStruct, 2),
        { 
            // The last argument passed to Struct.create can be additional properties for the object
            // These properties will be available on every instance of this struct that is created
            myFunction: {
                value: function () {
                    console.log("myFunction has been called");
                }
            }
        }
    );

    // readStructs accepts the following arguments:
    //  arrayBuffer - the ArrayBuffer to read from
    //  offset - the byte offset into the buffer where reading should start
    //  count - the number of structs to read. Structs are assumed to be tightly packed
    // returns an array of structs
    var a = SimpleStruct.readStructs(buffer, 0, 2); // Returns an array of 2 simpleStructs
    var b = ComplexStruct.readStructs(buffer, 32, 1); // Returns an array of 1 complexStruct

    // myFunction will be available on every instance of a ComplexStruct
    b[0].myFunction();

    // readStructs can also accept a callback, which will be called with the parsed structure and offset of that 
    // structure within the stream as they are parsed.
    SimpleStruct.readStructs(buffer, 0, 2, function (newStruct, offset) {
        console.log("Parsed " + newStruct + " at offset " + offset);
    });

}