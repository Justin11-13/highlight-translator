/* =========================================
   SIZE
========================================= */

const width = 470;
const height = 290;


/* =========================================
   DEFAULTS
========================================= */

const defaults = {

    /* TIME */

    autoTime: true,

    timeMaterialEnabled: true,

    timeLightingEnabled: true,

    manualTime: 12,

    sunrise: 6.5,

    sunset: 19,

    transitionWidth: 1,


    /* GEOMETRY */

    radius: 38,

    bezelWidth: 40,

    glassThickness: 16,


    /* OPTICAL */

    refractionStrength: 0.80,

    svgScale: 45,

    edgeFalloffPower: 1.35,


    /*
        IMPORTANT:

        Blur is now GLOBAL.

        Time of Day will NOT modify this value.
    */

    blur: 0.3,


    /* LIGHTING */

    lightX: -0.7,

    lightY: -0.7,

    lightTimeOffset: 0,

    rimLightStrength: 1.8,

    rimLightWidth: 10,


    /* DAY MATERIAL */

    daySpecular: 1.40,

    daySpecularFocus: 3,

    dayTint: 0.04,

    daySaturation: 1.15,

    dayRefraction: 1,


    /* NIGHT MATERIAL */

    nightSpecular: 1.15,

    nightSpecularFocus: 4.5,

    nightTint: 0.035,

    nightSaturation: 1.10,

    nightRefraction: 1.05
};


const state = {
    ...defaults
};


/* =========================================
   DOM
========================================= */

const glassCard =
    document.querySelector(
        ".glass-card"
    );


const displacementFilter =
    document.getElementById(
        "displacement-filter"
    );


const displacementImage =
    document.getElementById(
        "displacement-image"
    );


const specularImage =
    document.getElementById(
        "specular-image"
    );


const currentTimeDisplay =
    document.getElementById(
        "currentTimeDisplay"
    );


const materialModeDisplay =
    document.getElementById(
        "materialModeDisplay"
    );


/* =========================================
   CANVAS
========================================= */

const displacementCanvas =
    document.createElement(
        "canvas"
    );


displacementCanvas.width =
    width;

displacementCanvas.height =
    height;


const displacementCtx =
    displacementCanvas.getContext(
        "2d"
    );


const specularCanvas =
    document.createElement(
        "canvas"
    );


specularCanvas.width =
    width;

specularCanvas.height =
    height;


const specularCtx =
    specularCanvas.getContext(
        "2d"
    );


/* =========================================
   HELPERS
========================================= */

function clamp(
    value,
    min,
    max
) {

    return Math.max(
        min,
        Math.min(
            max,
            value
        )
    );
}


function lerp(
    a,
    b,
    t
) {

    return (
        a +
        (b - a) * t
    );
}


function smoothstep(
    edge0,
    edge1,
    x
) {

    if (
        edge0 === edge1
    ) {

        return 0;
    }


    x =
        clamp(

            (x - edge0) /
            (edge1 - edge0),

            0,
            1
        );


    return (
        x *
        x *
        (3 - 2 * x)
    );
}


/* =========================================
   TIME
========================================= */

function getRealTimeHours() {

    const now =
        new Date();


    return (
        now.getHours()

        +

        now.getMinutes() / 60

        +

        now.getSeconds() / 3600
    );
}


function getCurrentHours() {

    return (
        state.autoTime

            ? getRealTimeHours()

            : state.manualTime
    );
}


function formatTime(
    hours
) {

    hours =
        (
            hours % 24 +
            24
        ) % 24;


    const h =
        Math.floor(
            hours
        );


    const m =
        Math.floor(
            (hours - h) *
            60
        );


    return (
        String(h)
            .padStart(
                2,
                "0"
            )

        +

        ":"

        +

        String(m)
            .padStart(
                2,
                "0"
            )
    );
}


/* =========================================
   DAY FACTOR
========================================= */

function calculateDayFactor(
    hours
) {

    const transition =
        Math.max(
            state.transitionWidth,
            0.01
        );


    const dawn =
        smoothstep(

            state.sunrise -
            transition,

            state.sunrise +
            transition,

            hours
        );


    const dusk =
        1 -
        smoothstep(

            state.sunset -
            transition,

            state.sunset +
            transition,

            hours
        );


    return clamp(
        dawn * dusk,
        0,
        1
    );
}


/* =========================================
   MATERIAL
========================================= */

function getMaterial() {

    const hours =
        getCurrentHours();


    let dayFactor =
        calculateDayFactor(
            hours
        );


    if (
        !state.timeMaterialEnabled
    ) {

        dayFactor = 1;
    }


    return {

        hours,

        dayFactor,


        /* DAY / NIGHT */

        specularStrength:
            lerp(

                state.nightSpecular,

                state.daySpecular,

                dayFactor
            ),


        specularPower:
            lerp(

                state.nightSpecularFocus,

                state.daySpecularFocus,

                dayFactor
            ),


        tint:
            lerp(

                state.nightTint,

                state.dayTint,

                dayFactor
            ),


        saturation:
            lerp(

                state.nightSaturation,

                state.daySaturation,

                dayFactor
            ),


        refractionMultiplier:
            lerp(

                state.nightRefraction,

                state.dayRefraction,

                dayFactor
            ),


        /*
            GLOBAL BLUR

            This is NOT interpolated.

            Time cannot overwrite it.
        */

        blur:
            state.blur
    };
}


/* =========================================
   24-HOUR CLOCKWISE LIGHT
========================================= */

function getLightDirection(
    hours
) {

    /*
        MANUAL MODE
    */

    if (
        !state.timeLightingEnabled
    ) {

        return {

            x:
                state.lightX,

            y:
                state.lightY
        };
    }


    /*
        TIME
    */

    let time =
        hours +
        state.lightTimeOffset;


    time =
        (
            (time % 24)
            +
            24
        ) % 24;


    /*
        FULL CLOCKWISE ORBIT

        00:00 = BOTTOM

        03:00 = BOTTOM LEFT

        06:00 = LEFT

        09:00 = TOP LEFT

        12:00 = TOP

        15:00 = TOP RIGHT

        18:00 = RIGHT

        21:00 = BOTTOM RIGHT
    */

    const angle =
        (
            (time - 12)
            /
            24
        )
        *
        Math.PI
        *
        2;


    return {

        x:
            Math.sin(
                angle
            ),

        y:
            -Math.cos(
                angle
            )
    };
}


/* =========================================
   ROUNDED RECT SDF
========================================= */

function roundedRectSDF(
    x,
    y
) {

    const radius =
        state.radius;


    const cx =
        width / 2;


    const cy =
        height / 2;


    const px =
        Math.abs(
            x - cx
        );


    const py =
        Math.abs(
            y - cy
        );


    const halfW =
        width / 2 -
        radius;


    const halfH =
        height / 2 -
        radius;


    const qx =
        px -
        halfW;


    const qy =
        py -
        halfH;


    const outsideX =
        Math.max(
            qx,
            0
        );


    const outsideY =
        Math.max(
            qy,
            0
        );


    const outsideDistance =
        Math.sqrt(

            outsideX *
            outsideX

            +

            outsideY *
            outsideY
        );


    const insideDistance =
        Math.min(

            Math.max(
                qx,
                qy
            ),

            0
        );


    return (
        outsideDistance

        +

        insideDistance

        -

        radius
    );
}


/* =========================================
   EDGE NORMAL
========================================= */

function getEdgeNormal(
    x,
    y
) {

    const epsilon =
        1;


    const dx =
        roundedRectSDF(
            x + epsilon,
            y
        )

        -

        roundedRectSDF(
            x - epsilon,
            y
        );


    const dy =
        roundedRectSDF(
            x,
            y + epsilon
        )

        -

        roundedRectSDF(
            x,
            y - epsilon
        );


    const length =
        Math.sqrt(

            dx * dx

            +

            dy * dy

        ) || 1;


    return {

        x:
            dx / length,

        y:
            dy / length
    };
}


/* =========================================
   CONVEX SURFACE
========================================= */

function surfaceHeight(
    insideDistance
) {

    if (
        insideDistance >=
        state.bezelWidth
    ) {

        return (
            state.glassThickness
        );
    }


    const t =
        clamp(

            insideDistance /
            state.bezelWidth,

            0,
            1
        );


    const safeT =
        Math.max(
            t,
            0.035
        );


    const profile =
        Math.sqrt(

            Math.max(

                0,

                1 -

                Math.pow(
                    1 - safeT,
                    2
                )
            )
        );


    return (
        profile *
        state.glassThickness
    );
}


/* =========================================
   SURFACE SLOPE
========================================= */

function surfaceSlope(
    insideDistance
) {

    const epsilon =
        0.75;


    const before =
        surfaceHeight(

            Math.max(

                insideDistance -
                epsilon,

                0
            )
        );


    const after =
        surfaceHeight(

            Math.min(

                insideDistance +
                epsilon,

                state.bezelWidth
            )
        );


    return (
        after -
        before
    )

    /

    (
        epsilon *
        2
    );
}


/* =========================================
   GENERATE MAPS
========================================= */

function generateMaps() {

    const material =
        getMaterial();


    const light =
        getLightDirection(
            material.hours
        );


    const lightLength =
        Math.sqrt(

            light.x *
            light.x

            +

            light.y *
            light.y

        ) || 1;


    const normalizedLightX =
        light.x /
        lightLength;


    const normalizedLightY =
        light.y /
        lightLength;


    /* DISPLACEMENT */

    const displacementImageData =
        displacementCtx.createImageData(
            width,
            height
        );


    const displacementData =
        displacementImageData.data;


    /* SPECULAR */

    const specularImageData =
        specularCtx.createImageData(
            width,
            height
        );


    const specularData =
        specularImageData.data;


    /* =====================================
       PIXELS
    ====================================== */

    for (
        let y = 0;
        y < height;
        y++
    ) {

        for (
            let x = 0;
            x < width;
            x++
        ) {

            const index =
                (
                    y *
                    width
                    +
                    x
                )
                *
                4;


            const distance =
                roundedRectSDF(
                    x,
                    y
                );


            const insideDistance =
                -distance;


            /* =============================
               OUTSIDE
            ============================= */

            if (
                insideDistance < 0
            ) {

                displacementData[index] =
                    128;

                displacementData[index + 1] =
                    128;

                displacementData[index + 2] =
                    128;

                displacementData[index + 3] =
                    255;


                specularData[index] =
                    0;

                specularData[index + 1] =
                    0;

                specularData[index + 2] =
                    0;

                specularData[index + 3] =
                    0;


                continue;
            }


            /* =============================
               EDGE NORMAL
            ============================= */

            const edgeNormal =
                getEdgeNormal(
                    x,
                    y
                );


            /* =============================
               CONVEX SLOPE
            ============================= */

            const slope =
                surfaceSlope(
                    insideDistance
                );


            const normalizedSlope =
                clamp(

                    Math.abs(
                        slope
                    ),

                    0,
                    1
                );


            const opticalSlope =
                Math.pow(

                    normalizedSlope,

                    state.edgeFalloffPower
                );


            /* =============================
               REFRACTION
            ============================= */

            const magnitude =
                clamp(

                    opticalSlope

                    *

                    state.refractionStrength

                    *

                    material
                        .refractionMultiplier,

                    0,
                    1
                );


            const displacementX =
                edgeNormal.x *
                magnitude;


            const displacementY =
                edgeNormal.y *
                magnitude;


            const r =
                clamp(

                    128

                    +

                    displacementX *
                    127,

                    0,
                    255
                );


            const g =
                clamp(

                    128

                    +

                    displacementY *
                    127,

                    0,
                    255
                );


            displacementData[index] =
                r;


            displacementData[index + 1] =
                g;


            displacementData[index + 2] =
                128;


            displacementData[index + 3] =
                255;


            /* =============================
               SURFACE NORMAL
            ============================= */

            const surfaceNormalX =
                edgeNormal.x *
                normalizedSlope;


            const surfaceNormalY =
                edgeNormal.y *
                normalizedSlope;


            const surfaceNormalZ =
                1;


            const normalLength =
                Math.sqrt(

                    surfaceNormalX *
                    surfaceNormalX

                    +

                    surfaceNormalY *
                    surfaceNormalY

                    +

                    surfaceNormalZ *
                    surfaceNormalZ

                ) || 1;


            const nx =
                surfaceNormalX /
                normalLength;


            const ny =
                surfaceNormalY /
                normalLength;


            /* =============================
               SURFACE SPECULAR
            ============================= */

            const surfaceFacing =
                Math.max(

                    nx *
                    normalizedLightX

                    +

                    ny *
                    normalizedLightY,

                    0
                );


            const bezelMask =
                1 -
                smoothstep(

                    0,

                    state.bezelWidth,

                    insideDistance
                );


            const surfaceSpecular =
                Math.pow(

                    surfaceFacing,

                    material.specularPower
                )

                *

                bezelMask

                *

                material.specularStrength;


            /* =============================
               DYNAMIC RIM LIGHT
            ============================= */

            /*
                IMPORTANT:

                NO minus sign here.

                light direction represents
                where the light source is.
            */

            const rimFacing =
                Math.max(

                    edgeNormal.x *
                    normalizedLightX

                    +

                    edgeNormal.y *
                    normalizedLightY,

                    0
                );


            /*
                Only illuminate the outer
                rim of the glass.
            */

            const rimDistanceMask =
                1 -
                smoothstep(

                    0,

                    state.rimLightWidth,

                    insideDistance
                );


            /*
                Concentrate highlight around
                the light-facing edge.
            */

            const rimDirectional =
                Math.pow(
                    rimFacing,
                    2.2
                );


            /*
                Night still has rim light,
                but slightly weaker.
            */

            const timeRimStrength =
                lerp(

                    0.65,

                    1.0,

                    material.dayFactor
                );


            const rimSpecular =
                rimDirectional

                *

                rimDistanceMask

                *

                state.rimLightStrength

                *

                timeRimStrength;


            /* =============================
               COMBINE LIGHT
            ============================= */

            const specular =
                surfaceSpecular

                +

                rimSpecular;


            const brightness =
                clamp(

                    specular *
                    255,

                    0,
                    255
                );


            specularData[index] =
                brightness;


            specularData[index + 1] =
                brightness;


            specularData[index + 2] =
                brightness;


            specularData[index + 3] =
                brightness;
        }
    }


    /* =====================================
       WRITE MAPS
    ====================================== */

    displacementCtx.putImageData(

        displacementImageData,

        0,
        0
    );


    specularCtx.putImageData(

        specularImageData,

        0,
        0
    );


    displacementImage.setAttribute(

        "href",

        displacementCanvas.toDataURL()
    );


    specularImage.setAttribute(

        "href",

        specularCanvas.toDataURL()
    );


    /* =====================================
       SVG SCALE
    ====================================== */

    displacementFilter.setAttribute(

        "scale",

        state.svgScale
    );


    /* =====================================
       CSS MATERIAL
    ====================================== */

    glassCard.style.setProperty(

        "--glass-radius",

        `${state.radius}px`
    );


    /*
        IMPORTANT:

        material.blur === state.blur

        Time does not change this.
    */

    glassCard.style.setProperty(

        "--glass-blur",

        `${material.blur}px`
    );


    glassCard.style.setProperty(

        "--glass-tint",

        material.tint
    );


    glassCard.style.setProperty(

        "--glass-saturation",

        material.saturation
    );


    /* =====================================
       TIME DISPLAY
    ====================================== */

    currentTimeDisplay.textContent =
        formatTime(
            material.hours
        );


    if (
        material.dayFactor >
        0.65
    ) {

        materialModeDisplay.textContent =
            "DAY";
    }

    else if (
        material.dayFactor <
        0.35
    ) {

        materialModeDisplay.textContent =
            "NIGHT";
    }

    else {

        materialModeDisplay.textContent =
            "TRANSITION";
    }


    updateInspector(
        material,
        light
    );
}


/* =========================================
   INSPECTOR
========================================= */

function updateInspector(
    material,
    light
) {

    document
        .getElementById(
            "debugDayFactor"
        )
        .textContent =
            material.dayFactor
                .toFixed(2);


    document
        .getElementById(
            "debugRefraction"
        )
        .textContent =
            (
                state.refractionStrength
                *
                material.refractionMultiplier
            )
            .toFixed(2);


    document
        .getElementById(
            "debugSpecular"
        )
        .textContent =
            material.specularStrength
                .toFixed(2);


    document
        .getElementById(
            "debugFocus"
        )
        .textContent =
            material.specularPower
                .toFixed(2);


    document
        .getElementById(
            "debugBlur"
        )
        .textContent =
            `${state.blur.toFixed(1)}px`;


    document
        .getElementById(
            "debugTint"
        )
        .textContent =
            material.tint
                .toFixed(3);


    document
        .getElementById(
            "debugSaturation"
        )
        .textContent =
            material.saturation
                .toFixed(2);


    document
        .getElementById(
            "debugLightX"
        )
        .textContent =
            light.x
                .toFixed(2);


    document
        .getElementById(
            "debugLightY"
        )
        .textContent =
            light.y
                .toFixed(2);
}


/* =========================================
   CONTROLS
========================================= */

const controls = {

    /* TIME */

    manualTime: {
        formatter: formatTime
    },

    sunrise: {
        formatter: formatTime
    },

    sunset: {
        formatter: formatTime
    },

    transitionWidth: {
        decimals: 1,
        suffix: "h"
    },


    /* GEOMETRY */

    radius: {
        decimals: 0,
        suffix: "px"
    },

    bezelWidth: {
        decimals: 0,
        suffix: "px"
    },

    glassThickness: {
        decimals: 0
    },


    /* OPTICAL */

    refractionStrength: {
        decimals: 2
    },

    svgScale: {
        decimals: 0
    },

    edgeFalloffPower: {
        decimals: 2
    },


    /*
        GLOBAL BLUR
    */

    blur: {
        decimals: 1,
        suffix: "px"
    },


    /* LIGHTING */

    lightX: {
        decimals: 2
    },

    lightY: {
        decimals: 2
    },

    lightTimeOffset: {
        decimals: 1,
        suffix: "h"
    },

    rimLightStrength: {
        decimals: 2
    },

    rimLightWidth: {
        decimals: 0,
        suffix: "px"
    },


    /* DAY */

    daySpecular: {
        decimals: 2
    },

    daySpecularFocus: {
        decimals: 2
    },

    dayTint: {
        decimals: 3
    },

    daySaturation: {
        decimals: 2
    },

    dayRefraction: {
        decimals: 2
    },


    /* NIGHT */

    nightSpecular: {
        decimals: 2
    },

    nightSpecularFocus: {
        decimals: 2
    },

    nightTint: {
        decimals: 3
    },

    nightSaturation: {
        decimals: 2
    },

    nightRefraction: {
        decimals: 2
    }
};


/* =========================================
   VALUE DISPLAY
========================================= */

function updateValueDisplay(
    key
) {

    const config =
        controls[key];


    const output =
        document.getElementById(
            `${key}Value`
        );


    const value =
        Number(
            state[key]
        );


    if (
        config.formatter
    ) {

        output.textContent =
            config.formatter(
                value
            );


        return;
    }


    output.textContent =
        value.toFixed(
            config.decimals
        )

        +

        (
            config.suffix ||
            ""
        );
}


/* =========================================
   BIND SLIDERS
========================================= */

Object
    .keys(
        controls
    )
    .forEach(
        key => {

            const input =
                document.getElementById(
                    key
                );


            input.addEventListener(

                "input",

                event => {

                    state[key] =
                        Number(
                            event.target.value
                        );


                    updateValueDisplay(
                        key
                    );


                    generateMaps();
                }
            );


            updateValueDisplay(
                key
            );
        }
    );


/* =========================================
   SWITCHES
========================================= */

const autoTimeInput =
    document.getElementById(
        "autoTime"
    );


const timeMaterialInput =
    document.getElementById(
        "timeMaterialEnabled"
    );


const timeLightingInput =
    document.getElementById(
        "timeLightingEnabled"
    );


autoTimeInput.addEventListener(

    "change",

    event => {

        state.autoTime =
            event.target.checked;


        updateDisabledStates();

        generateMaps();
    }
);


timeMaterialInput.addEventListener(

    "change",

    event => {

        state.timeMaterialEnabled =
            event.target.checked;


        generateMaps();
    }
);


timeLightingInput.addEventListener(

    "change",

    event => {

        state.timeLightingEnabled =
            event.target.checked;


        updateDisabledStates();

        generateMaps();
    }
);


/* =========================================
   DISABLED STATES
========================================= */

function updateDisabledStates() {

    document
        .getElementById(
            "manualTime"
        )
        .disabled =
            state.autoTime;


    document
        .getElementById(
            "lightX"
        )
        .disabled =
            state.timeLightingEnabled;


    document
        .getElementById(
            "lightY"
        )
        .disabled =
            state.timeLightingEnabled;
}


/* =========================================
   PREVIEW TIMES
========================================= */

function previewTime(
    time
) {

    state.autoTime =
        false;


    autoTimeInput.checked =
        false;


    state.manualTime =
        time;


    document
        .getElementById(
            "manualTime"
        )
        .value =
            time;


    updateValueDisplay(
        "manualTime"
    );


    updateDisabledStates();

    generateMaps();
}


/* DAY */

document
    .getElementById(
        "dayPreviewButton"
    )
    .addEventListener(

        "click",

        () =>
            previewTime(12)
    );


/* SUNSET */

document
    .getElementById(
        "sunsetPreviewButton"
    )
    .addEventListener(

        "click",

        () =>
            previewTime(
                state.sunset
            )
    );


/* NIGHT */

document
    .getElementById(
        "nightPreviewButton"
    )
    .addEventListener(

        "click",

        () =>
            previewTime(0)
    );


/* =========================================
   RESET
========================================= */

document
    .getElementById(
        "resetButton"
    )
    .addEventListener(

        "click",

        () => {

            Object.assign(
                state,
                defaults
            );


            Object
                .keys(
                    controls
                )
                .forEach(
                    key => {

                        const input =
                            document
                                .getElementById(
                                    key
                                );


                        input.value =
                            state[key];


                        updateValueDisplay(
                            key
                        );
                    }
                );


            autoTimeInput.checked =
                state.autoTime;


            timeMaterialInput.checked =
                state.timeMaterialEnabled;


            timeLightingInput.checked =
                state.timeLightingEnabled;


            updateDisabledStates();

            generateMaps();
        }
    );


/* =========================================
   AUTO TIME UPDATE
========================================= */

setInterval(

    () => {

        if (
            state.autoTime
        ) {

            generateMaps();
        }

    },

    60000
);


/* =========================================
   START
========================================= */

updateDisabledStates();

generateMaps();