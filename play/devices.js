'use strict';

// Using metric units. For the conversion, see:
// https://en.wikipedia.org/wiki/Surface-mount_technology#Packages

// A device is the base class for all electronic components: LEDs, MCUs, and
// even whole boards.
class Device {
    // Properties of this particular instance (that can sometimes change).
    //  - id
    //  - type
    //  - url
    //  - x, y (in pixels)
    //  - color
    properties = null;

    // Read-only details that are fixed for this instance.
    //  - width, height (in mm)
    //  - background
    //  - objects
    //  - pins
    data = null;

    constructor(parent, properties, data) {
        this.parent = parent;
        this.properties = properties;
        this.data = data;
        this.element = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.element.classList.add('device');
        this.element.dataset.id = this.id; // mainly for debugging
    }

    get id() {
        return this.properties.id;
    }

    get name() {
        return this.properties.name || this.data.name;
    }

    get width() {
        return this.data.width;
    }

    get height() {
        return this.data.height;
    }

    get rotation() {
        return this.properties.rotation || 0;
    }

    updateShape() {
        this.element.style.width = this.width + 'mm';
        this.element.style.height = this.height + 'mm';
    }

    // Return this and all child objects.
    getObjects() {
        // For most devices, simply return itself.
        // Composite devices need to override this method.
        return new Set([this]);
    }

    getPin(index) {
        return this.pins[index];
    }

    getPinByName(name) {
        for (let pin of this.pins) {
            if (pin.name == name) {
                return pin;
            }
        }
    }

    // getHTML returns the element that should be placed in the devices tab of
    // the bottom panel. It returns null if the device does not support this.
    getHTML() {
        return null;
    }

    onPinChange(pin) {
    }

    writeWS2812Byte(pin, c) {
    }
}

class Microcontroller extends Device {
    constructor(parent, properties, data) {
        super(parent, properties, data);
        this.pins = [];
        for (let pinData of data.pins) {
            this.pins.push(new Pin(this, pinData));
        }

        this.runner = null;
    }

    async runURL(url, logger) {
        // Compile the script.
        if (this.runner) {
            this.runner.stop();
        }
        for (let pin of this.pins) {
            pin.reset();
        }
        this.runner = new Runner(this, logger);
        await this.runner.run(await fetch(url));
    }

    async runBinary(binary, logger) {
        if (this.runner) {
            this.runner.stop();
        }
        for (let pin of this.pins) {
            pin.reset();
        }
        this.runner = new Runner(this, logger);
        await this.runner.run(binary);
    }
}

class LED extends Device {
    static shapes = {
        'tht-5mm': {
            width: 5,
            height: 5,
            type: 'tht',
            name: '5mm',
        },
        'smd-2012': {
            width: 2.0,
            height: 1.2,
            type: 'smd',
            name: 'SMD 2012/0806 (2.0x1.2mm)',
        },
    };

    constructor(parent, properties) {
        if (!properties.color) {
            // Default color to red.
            properties.color = '#ff0000';
        }
        if (!(properties.shape in LED.shapes)) {
            // Default shape to a typical 5mm through hole LED.
            properties.shape = 'tht-5mm';
        }
        super(parent, properties);

        // Create the div for the devices panel.
        this.infoDiv = document.createElement('div');

        this.pins = [
            new Pin(this, {name: 'anode'}),
            new Pin(this, {name: 'cathode'}),
        ];

        // Create shape.
        this.updateShape();
    }

    get name() {
        return this.properties.name || 'LED';
    }

    get shapes() {
        return LED.shapes;
    }

    get shape() {
        return this.shapes[this.properties.shape];
    }

    get width() {
        return this.shape.width;
    }

    get height() {
        return this.shape.height;
    }

    updateShape() {
        super.updateShape();

        // Remove old shape if necessary.
        if (this.plastic) {
            this.plastic.remove();
            this.plastic = undefined;
        }
        if (this.base) {
            this.base.remove();
            this.base = undefined;
        }

        // Update pin pads.
        if (this.parent instanceof Play) {
            // Not on a board, so show the pins.
            this.pins[0].data.x = -0.5;
            this.pins[0].data.y = this.height / 2;
            this.pins[0].updateShape();
            this.pins[1].data.x = this.width + 0.5;
            this.pins[1].data.y = this.height / 2;
            this.pins[1].updateShape();
        }

        if (this.shape.type == 'smd') {
            // Create the base of the LED.
            this.base = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            this.base.style.left = 0;
            this.base.style.top = 0;
            this.base.style.width = '2.0mm';
            this.base.style.height = '1.2mm';
            this.base.style.fill = '#a88b32';
            this.element.appendChild(this.base);

            // Create the square piece of plastic that contains the chip itself.
            this.plastic = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            this.plastic.style.x = '0.4mm';
            this.plastic.style.y = 0;
            this.plastic.style.width = '1.2mm';
            this.plastic.style.height = '1.2mm';
            this.plastic.style.fill = this.properties.color;
            this.element.appendChild(this.plastic);
        } else { // tht
            // Create the round piece of plastic that is the outside part of the
            // LED.
            this.plastic = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            this.element.appendChild(this.plastic);
            this.plastic.style.r = (this.width / 2 ) + 'mm';
            this.plastic.style.cx = (this.width / 2 ) + 'mm';
            this.plastic.style.cy = (this.width / 2 ) + 'mm';
            this.plastic.style.fill = this.properties.color;
            this.element.appendChild(this.plastic);
        }

        // Update on/off state.
        this.onPinChange();
    }

    set(on) {
        let opacity = '0.5';
        let filter = '';
        if (on) {
            opacity = ''
            let size = (0.4 + this.height / 4) + 'mm';
            filter = 'drop-shadow(0 0 ' + size + ' ' + this.properties.color + ')';
        }
        this.plastic.style.opacity = opacity;
        this.plastic.style.filter = filter;

        this.infoDiv.textContent = on ? 'on' : 'off';
    }

    getHTML() {
        return this.infoDiv;
    }

    onPinChange() {
        // The LED turns on when at least one of the pins is correctly connected
        // (not floating). This makes it easier to wire them (no need for a
        // VCC/ground wire) while retaining somewhat real-world behavior by not
        // turning on when both pins are floating.
        let anode = false;   // true if high
        let cathode = false; // true if low
        for (let pin of this.pins[0].connected) {
            if (pin.mode == 'output') {
                anode = pin.high;
            }
        }
        for (let pin of this.pins[1].connected) {
            if (pin.mode == 'output') {
                cathode = !pin.high;
            }
        }
        let anodeConnected = this.pins[0].connected.size > 1;
        let cathodeConnected = this.pins[1].connected.size > 1;
        let on = anodeConnected || cathodeConnected;
        if (anodeConnected && !anode) {
            on = false;
        }
        if (cathodeConnected && !cathode) {
            on = false;
        }
        this.set(on);
    }
}

class WS2812 extends Device {
    constructor(parent, properties) {
        super(parent, properties, {
            width: 5,
            height: 5,
        });

        // Color bytes in the WS2812 shift register.
        this.bytesInShiftRegister = 0; // reset to 0 every latch
        this.color = [0, 0, 0];

        this.pins = [
            new Pin(this, {name: 'din', x: -0.5, y: 2.5, mode: 'input'}),
            new Pin(this, {name: 'dout', x: 5.5, y: 2.5, mode: 'output'}),
        ];

        let base = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        this.element.appendChild(base);
        base.style.fill = 'white';
        base.style.x = 0;
        base.style.y = 0;
        base.style.width = '5mm';
        base.style.height = '5mm';

        this.led = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        this.element.appendChild(this.led);
        this.led.style.r = '2mm';
        this.led.style.cx = '2.5mm';
        this.led.style.cy = '2.5mm';
        this.led.style.fill = 'black';

        this.infoDiv = document.createElement('div');
        this.infoDiv.innerHTML = 'rgb(<span class="r">0</span>, <span class="g">0</span>, <span class="b">0</span>)';
    }

    get name() {
        return 'WS2812';
    }

    getHTML() {
        return this.infoDiv;
    }

    writeWS2812Byte(pin, c) {
        // Only listen to this if the signal comes from the input pin.
        if (pin != this.pins[0])
            return;

        // Shift data to the next device. Only do this when there are already 3
        // bytes in the shift register (reset on latch) to match actual WS2812
        // behavior.
        if (this.bytesInShiftRegister == 3) {
            for (let pin of this.pins[1].connected) {
                pin.device.writeWS2812Byte(pin, this.color[2]);
            }
        }

        // Shift data into internal shift register.
        this.color[2] = this.color[1];
        this.color[1] = this.color[0];
        this.color[0] = c;
        this.bytesInShiftRegister = Math.min(3, this.bytesInShiftRegister+1);

        // Update the LED after some time has passed.
        if (!this.latchTimeout) {
            this.latchTimeout = requestAnimationFrame(this.latch.bind(this), 0);
        }
    }

    latch() {
        this.latchTimeout = undefined;
        this.bytesInShiftRegister = 0;

        // Colors are normally in GRB order.
        // Because colors get shifted, the order is reversed.
        let g = this.color[2];
        let r = this.color[1];
        let b = this.color[0];

        this.infoDiv.querySelector('.r').textContent = r;
        this.infoDiv.querySelector('.g').textContent = g;
        this.infoDiv.querySelector('.b').textContent = b;

        let brightness = (r + g + b) / (255*3);

        // Do a gamma correction. The LEDs are in linear color space, while the
        // web uses the sRGB color space (with gamma=~2.2).
        // I'm not sure why the gamma needs to be this high (gamma=4), but that's
        // how I managed to get them sort-of similar to the real LEDs.
        // Without any gamma correction, the LEDs would look way too dark.
        r = Math.pow(r / 255, 1/4) * 255;
        g = Math.pow(g / 255, 1/4) * 255;
        b = Math.pow(b / 255, 1/4) * 255;
        brightness = Math.pow(brightness, 1/4);

        let filter = 'drop-shadow(0 0 2mm rgba(' + [r, g, b, brightness].join(', ') + '))';
        this.led.style.filter = filter;
        this.led.style.fill = 'rgb(' + r + ', ' + g + ', ' + b + ')';
    }
}

class Composite extends Device {
    constructor(parent, properties, data) {
        super(parent, properties, data);

        if (data.background) {
            // Load the background SVG using a promise so that loadChildren can
            // wait until the background is fully loaded. The pins are only
            // fully valid (with backgroundElement set) after this is done.
            this.backgroundLoaded = new Promise((resolve, reject) => {
                // Using an XHR here because the fetch API doesn't directly
                // allow loading XML documents.
                let req = new XMLHttpRequest();
                req.responseType = 'document';
                req.open('GET', 'devices/'+data.background);
                req.send();
                req.onload = () => {
                    let svg = req.response.documentElement;
                    this.element.prepend(svg);
                    for (let i=0; i<this.pins.length; i++) {
                        let pin = this.pins[i];
                        if (pin.data.svgId) {
                            pin.backgroundElement = svg.getElementById(pin.data.svgId);
                            pin.backgroundElement.classList.add('pin');
                        }
                    }
                    resolve();
                };
                req.onerror = (e) => {
                    // TODO: properly handle this error.
                    console.error('failed to load device background for '+this.name+':', e)
                }
            });
        }

        this.pins = [];
        for (let pinData of this.data.pins) {
            let pin = new Pin(this, pinData);
            this.pins.push(pin);
        }
    }

    async loadChildren() {
        this.objects = {};
        for (let child of this.data.objects) {
            let obj = await createObject(this, child);
            this.objects[child.id] = obj;
            this.element.appendChild(obj.element);
            let [x, y] = applyRotation(obj.rotation, obj.width, obj.height);
            obj.element.style.transform = 'translate(' + (child.x + x) + 'mm, ' + (child.y + y) + 'mm) rotate(' + obj.rotation + 'deg)';
        }

        for (let i=0; i<this.pins.length; i++) {
            let pin = this.pins[i];
            pin.connectedOnBoard = new Set();
            pin.connectedOnBoard.add(pin);
            if (pin.data.connected) {
                for (let connection of pin.data.connected) {
                    let childPin = this.objects[connection.id].getPinByName(connection.pin);
                    if (!childPin) {
                        console.error('pin undefined:', connection);
                        continue;
                    }
                    pin.connectedOnBoard.add(childPin);
                    childPin.connectedOnBoard = pin.connectedOnBoard;
                }
            }
        }

        // It may be necessary to load until the background is fully loaded
        // before returning (as otherwise the pins are not ready).
        if (this.backgroundLoaded) {
            await this.backgroundLoaded;
        }
    }

    get name() {
        return this.properties.name || this.data.name;
    }

    // Return this and all child objects.
    getObjects() {
        let objects = new Set([this]);
        for (let id in this.objects) {
            for (let child of this.objects[id].getObjects()) {
                objects.add(child);
            }
        }
        return objects;
    }
}

let devices = {
    mcu: Microcontroller,
    led: LED,
    ws2812: WS2812,
};

function hasParent(element) {
    if (!element.parentNode) {
        return false;
    }
    if (element == document.body) {
        return true;
    }
    return hasParent(element.parentNode);
}
