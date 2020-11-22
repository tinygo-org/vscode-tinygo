'use strict';

// Using metric units. For the conversion, see:
// https://en.wikipedia.org/wiki/Surface-mount_technology#Packages

// A pin is a single connection on the outside of a device. It can for example
// be a leg on a LED or a header pin on a board.
class Pin {
    constructor(device, data) {
        this.device = device;
        this.data = data;
        this.mode = data.mode || 'input';
        this.high = false;
        this.spans = [];
        this.connectedOnBoard = new Set([this]); // connected together on a single development board
        this.connectionCache = null;
        this.connectionCacheVersion = 0;
        this.wires = new Set(); // wires between development boards or independent electronics

        // The pin uses one or two elements.
        // - When data.svgId is set, the background SVG for the device (normally
        //   a board) will be loaded and the element with that ID will be set to
        //   this.backgroundElement. this.element will then be a very small
        //   invisible square just enough for wires to know where to position
        //   themselves.
        // - Otherwise (and normally) data.svgId is not set, meaning that
        //   this.backgroundElement remains null and this.element is the element
        //   that is used for presentation of this pin.
        this.element = null;
        this.backgroundElement = null;

        this.updateShape();
    }

    // Reset this pin to the initial power-on state.
    reset() {
        this.mode = this.data.mode || 'input';
        this.high = false;
        this.update();
    }

    get name() {
        return this.data.name;
    }

    get humanName() {
        return this.device.name + ' ' + this.data.name;
    }

    get connected() {
        if (this.connectionCache !== null && this.connectionCacheVersion == wireConfigurationVersion) {
            return this.connectionCache;
        }

        let uncheckedWires = new Set();
        let checkedWires = new Set();

        // Start out with all the pins that are directly connected together (on
        // a single development board).
        let connected = new Set();
        for (let pin of this.connectedOnBoard.keys()) {
            connected.add(pin);
            for (let wire of pin.wires) {
                uncheckedWires.add(wire);
            }
        }

        while (uncheckedWires.size) {
            // Pick one of the wires.
            let wire;
            for (let w of uncheckedWires) {
                wire = w;
            }

            // Mark it as checked.
            uncheckedWires.delete(wire);
            checkedWires.add(wire);

            // Add both pins at the ends of this wire.
            for (let pin of [wire.from, wire.to]) {
                for (let pinOnBoard of pin.connectedOnBoard) {
                    connected.add(pinOnBoard);
                }
                for (let pinWire of pin.wires) {
                    if (!checkedWires.has(pinWire)) {
                        uncheckedWires.add(pinWire);
                    }
                }
            }
        }

        this.connectionCacheVersion = wireConfigurationVersion;
        this.connectionCache = connected;
        return connected;
    }

    setMode(mode) {
        this.mode = mode;
        this.update();
    }

    set(high) {
        this.high = high;
        this.update();
    }

    update() {
        for (let span of this.spans) {
            if (!hasParent(span)) {
                this.spans = this.spans.filter(sp => sp !== span);
                continue;
            }
            this.updateSpan(span);
        }

        for (let pin of this.connected.keys()) {
            pin.device.onPinChange(pin);
        }
    }

    updateShape() {
        // Remove old element if present.
        if (this.element) {
            this.element.remove();
            this.element = undefined;
        }

        // Create new element if needed.
        if ('x' in this.data && 'y' in this.data) {
            this.element = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            let size = 2;
            if (this.data.svgId) {
                // See the class constructor for an explanation.
                // Size can't be 0 otherwise getBoundingClientRect (to determine
                // wire location) won't work.
                size = 0.001;
                this.element.style.fill = 'transparent';
            }
            this.element.style.width = size+'mm';
            this.element.style.height = size+'mm';
            this.element.style.x = (this.data.x - size/2) + 'mm';
            this.element.style.y = (this.data.y - size/2) + 'mm';
            this.element.classList.add('pin');
            this.device.element.appendChild(this.element);
        }

        // Layout all wires connected to the device.
        for (let wire of this.wires) {
            wire.layout();
        }
    }

    updateSpan(span) {
        span.setAttribute('data-mode', this.mode);
        span.classList.toggle('output-high', this.high)
    }

    createPinSpan() {
        let span = document.createElement('span');
        span.textContent = this.humanName;
        span.classList.add('pin');
        this.updateSpan(span);
        this.spans.push(span);
        return span;
    }
}

// A wire connects two pins together, forming an electrical connection.
class Wire {
    constructor(play, data) {
        this.data = data;

        // Create the element.
        this.element = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        this.element.classList.add('wire');

        // Add the wire to the pins.
        this.from = play.objects[data.from.id].obj.getPinByName(data.from.pin);
        if (data.to) {
            // Both from and to are set, which means that it's a regular wire
            // (not a wire being added at the moment).
            this.to = play.objects[data.to.id].obj.getPinByName(data.to.pin);
            if (!this.from || !this.to) {
                // Special case.
                // While both from and to are set, at least one is not present
                // at the moment. This can happen when the main board has been
                // changed and this wire is attached to a pin that existed on
                // the old board but doesn't exist on the new board.
                // Deal with this by not adding this wire to the pins and hiding
                // the SVG line object.
                this.element.style.display = 'none';
                return;
            }
            this.to.wires.add(this);
        } else {
            // This wire is still being created: the first pad (from) has been
            // clicked but the second pad (to) hasn't yet.
            this.to = null;
        }
        this.from.wires.add(this);
    }

    layout() {
        if (this.element.style.display == 'none') {
            // One of the attached pins does not exist, the wire isn't shown, so
            // don't bother laying it out.
            return;
        }

        let fromRect = this.from.element.getBoundingClientRect();
        let x1 = fromRect.x+fromRect.width/2;
        let y1 = fromRect.y+fromRect.height/2;
        let x2;
        let y2;

        if (this.to) {
            // Regular wire.
            let toRect = this.to.element.getBoundingClientRect();
            x2 = toRect.x+toRect.width/2;
            y2 = toRect.y+toRect.height/2;
        } else {
            // Wire that is being added. x2 and y2 should be close to the mouse
            // pointer, but not exactly under it.
            let x = this.mouseX - x1;
            let y = this.mouseY - y1;
            let length = Math.sqrt(x*x + y*y); // Pythagoras
            // Make sure the line doesn't go all the way to the pointer so that
            // hover still works.
            let reduceX = (5 * x / length);
            let reduceY = (5 * y / length);
            x2 = this.mouseX - reduceX;
            y2 = this.mouseY - reduceY;
        }

        this.element.setAttribute('x1', x1);
        this.element.setAttribute('y1', y1);
        this.element.setAttribute('x2', x2);
        this.element.setAttribute('y2', y2);
    }

    remove() {
        // Calling 'remove' is not enough to remove the wire completely, see
        // Play.removeWire.
        this.element.remove();
        this.from.wires.delete(this);
        if (this.to) {
            this.to.wires.delete(this);
        }
    }

    // setTo sets the second pin this wire is attached to. This is used when
    // adding a new wire and the second pin is clicked. It finalizes the
    // creation of the wire.
    setTo(pin) {
        delete this.mouseX;
        delete this.mouseY;
        this.to = pin;
        this.to.wires.add(this);
        this.data.to = {
            id: pin.device.id,
            pin: pin.name,
        }
        this.layout();
    }
}

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
        this.element.style.width = this.width+'mm';
        this.element.style.height = this.height+'mm';
        this.element.style.transform = 'translate(' + properties.x + 'mm, ' + properties.y + 'mm)';
        this.element.classList.add('device');
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
