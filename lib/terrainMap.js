import axios from 'axios'
import BinaryHeap from './binaryHeap'

// Lat/Long Ratios found from (https://www.usgs.gov/faqs/how-much-distance-does-a-degree-minute-and-second-cover-your-maps?qt-news_science_products=0#qt-news_science_products)
const _nodeDistance = 10;  // The higher the distance, the less accurate it will be. Too low and we'll run out of resources (though it'll be very accurate)
const _longitudeRatio = 111699;  // # of m per degree of longitude
const _latitudeRatio = 111000;  // # of m per degree of latitude

class MapNode {
    constructor(x, y, e, t, px, py) {
        this.id = `${px}/${py}`;  // position in flatmap, easier to find neighbors
        this.x = x || 0;  // x coordinate for map
        this.y = y || 0;  // y coordinate for map
        
        this.elevation = e || 0;
        this.terrain = t || '';
    }
}

export default class TerrainMap {
    constructor(p1, p2) {
        this.startPoint = p1;
        this.endPoint = p2;

        this.boundingBox = {
            topLeft: [],
            topRight: [],
            bottomLeft: [],
            bottomRight: []
        };

        // These are the nodes on the flatmap that are closest to the start/end nodes
        this.startNodeId = '';
        this.endNodeId = '';

        this.nodes = {};
        this.neighbors = {};

        this.route = {
            path: [],
            distance: 0,
            eta: 0,
            calories: 0,
            elevationDelta: 0
        };

        // Metrics for performance analysis: only useful for this project
        this.timestamps = {
            createBoundingBox: 0,
            createFlatmap: 0,
            getElevation: 0,
            getTerrain: 0,
            createRoute: 0,
        }

        this.generateBoundingBox(p1, p2);
    }

    addMapNode(currentX, currentY, elevation, terrain, posX, posY) {
        // Add node to map
        let newNode = new MapNode(currentX, currentY, elevation, terrain, posX, posY);
        this.nodes[newNode.id] = newNode;

        // Add an empty array to push neighbors to later
        this.neighbors[newNode.id] = [];

        return newNode;
    }

    addNeighbor(node1, node2) {
        let results = this.getNeighborDistance(node1, node2);
        let gradeFactor = 1;

        // If the grade is too steep or too deep, it isn't traversable so make it infinite distance
        // This will make the modified Dijkstra's algorithm never choose that route
        if (results.grade < 0.5 && results.grade > -0.5) {
            gradeFactor = 50;
        }

        this.neighbors[node1.id].push({
            node: node2.id,
            distance: results.distance,
            calories: results.calories,
            gradeFactor: gradeFactor
        });

        this.neighbors[node2.id].push({
            node: node1.id,
            distance: results.distance,
            calories: results.calories,
            gradeFactor: gradeFactor
        });
    }
    
    // Using Haversine formula, adapted from http://www.movable-type.co.uk/scripts/latlong.html
    getNeighborDistance(node1, node2) {
        const R = 6371e3;  // meters
        const phi1 = node1.y * Math.PI / 180;
        const phi2 = node2.y * Math.PI / 180;
        const deltaLat = (node2.y - node1.y) * Math.PI / 180;
        const deltaLong = (node2.x - node1.x) * Math.PI / 180;

        const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
                Math.cos(phi1) * Math.cos(phi2) *
                Math.sin(deltaLong / 2) * Math.sin(deltaLong / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

        const distance = R * c;

        // 150 lb person burns 4 calories/minute @ 1.34112 meters/sec. (https://caloriesburnedhq.com/calories-burned-walking/)
        // For every 1% of grade, increase calories burned by about 0.007456472% more calories per meter for a 150-pound person (https://www.verywellfit.com/how-many-more-calories-do-you-burn-walking-uphill-3975557) 
        let secondsToTravel = (distance / 1.34112);
        let percentGrade = (node2.elevation - node1.elevation) / distance;
        let calorieMultiplierFromElevation = 0.00007456472 / percentGrade / 100;
        let caloriesBurned = (4 / 60) * secondsToTravel;
        caloriesBurned += (calorieMultiplierFromElevation * caloriesBurned);

        return {
            distance: distance,
            calories: caloriesBurned,
            grade: percentGrade
        };
    }
//  so things work when start is on top right, otherwise it kinda flips a bit
//  also try and figure out what to do with elevation weights`
    generateBoundingBox(p1, p2) {
        let startTime = Date.now();
        let minX, minY, maxX, maxY;
    
        // Find min/max x values
        if (p1.x < p2.x) {
            minX = p1.x;
            maxX = p2.x;
        } else {
            minX = p2.x;
            maxX = p1.x;
        }

        // Find min/max y values
        if (p1.y < p2.y) {
            minY = p1.y;
            maxY = p2.y;
        } else {
            minY = p2.y;
            maxY = p1.y;
        }

        // Scale the BB so it's a more uniform square
        // This covers edge cases when the start and end points share an axis
        let slope = Math.abs((p2.y - p1.y) / (p2.x - p1.x));
        if (slope < 1) {
            // Scale Y values
            let deltaY = maxY - minY;
            let scale = deltaY / 3 * Math.abs((p2.x - p1.x) / (p2.y - p1.y));
            maxY += scale;
            minY -= scale;
        } else if (slope > 1) {
            // Scale X values
            let deltaX = maxX - minX;
            let scale = deltaX / 3 * slope;
            maxX += scale;
            minX -= scale;
        }

        this.boundingBox.topLeft = [minX, maxY];
        this.boundingBox.topRight = [maxX, maxY];
        this.boundingBox.bottomLeft = [minX, minY];
        this.boundingBox.bottomRight = [maxX, minY];

        this.timestamps.createBoundingBox = Date.now() - startTime;
    }

    async generateFlatmap() {
        let startTime = Date.now();

        // Create a node at regular intervals along the X and Y axis
        let elevationRequests = [], terrainRequests = [];
        let xInterval = _nodeDistance / _longitudeRatio;
        let yInterval = _nodeDistance / _latitudeRatio;

        let posX = 0, posY = 0;
        let maxY = Math.floor((this.boundingBox.topLeft[1] - this.boundingBox.bottomLeft[1]) / yInterval);

        // This for loop cluster can be mitigated if I didn't have to rely on external services for altitude and terrain info
        // If this were a production app, this type of info will be store in a DB and wouldn't need its own loop
        for (let currentX = this.boundingBox.topLeft[0]; currentX < this.boundingBox.topRight[0]; currentX += xInterval) {
            posY = 0;

            for (let currentY = this.boundingBox.bottomLeft[1]; currentY < this.boundingBox.topLeft[1]; currentY += yInterval) {
                terrainRequests.push(axios.get(`http://api.geonames.org/findNearbyJSON?lat=${currentY}&lng=${currentX}&username=agaudreau`));
                elevationRequests.push(axios.get(`https://nationalmap.gov/epqs/pqs.php?units=feet&output=json&x=${currentX}&y=${currentY}&callback=JSON_CALLBACK`));

                posY++;
            }

            posX++;
        }

        // Get the elevation and terrain for each node so we can calculate distances
        let elevations = await this.getNodeElevations(elevationRequests);
        //let terrain = await this.getNodeTerrains(terrainRequests);

        let startNodeX = Infinity, startNodeXVal = Infinity, startNodeY = Infinity, startNodeYVal = Infinity;
        let endNodeX = Infinity, endNodeXVal = Infinity, endNodeY = Infinity, endNodeYVal = Infinity;

        posX = 0;
        for (let currentX = this.boundingBox.topLeft[0]; currentX < this.boundingBox.topRight[0]; currentX += xInterval) {
            posY = 0;

            // Find the closest point on the flatmap to the start/end nodes along X axis
            if (Math.abs(this.startPoint.x - currentX) < startNodeXVal) {
                startNodeX = posX;
                startNodeXVal = Math.abs(this.startPoint.x - currentX);
            }
            if (Math.abs(this.endPoint.x - currentX) < endNodeXVal) {
                endNodeX = posX;
                endNodeXVal = Math.abs(this.endPoint.x - currentX);
            }

            for (let currentY = this.boundingBox.bottomLeft[1]; currentY < this.boundingBox.topLeft[1]; currentY += yInterval) {
                let elev = elevations[`${currentX}/${currentY}`]
                //let terr = terrain[`${currentX}/${currentY}`]

                // Find the closest point on the flatmap to the start/end nodes along Y axis
                if (Math.abs(this.startPoint.y - currentY) < startNodeYVal) {
                    startNodeY = posY;
                    startNodeYVal = Math.abs(this.startPoint.y - currentY);
                }
                if (Math.abs(this.endPoint.y - currentY) < endNodeYVal) {
                    endNodeY = posY;
                    endNodeYVal = Math.abs(this.endPoint.y - currentY);
                }

                // Add the current node to the flatmap
                let newNode = this.addMapNode(currentX, currentY, elev, '', posX, posY);

                // Add neighbors (to the left, top, and/or diagonals) to new map node
                if (posX > 0) {
                    this.addNeighbor(newNode, this.nodes[`${posX - 1}/${posY}`])  // Neighbor to the left
                    if (posY < maxY) {
                        this.addNeighbor(newNode, this.nodes[`${posX - 1}/${posY + 1}`])  // Neighbor to the upper left 
                    }
                    if (posY > 0) {
                        this.addNeighbor(newNode, this.nodes[`${posX - 1}/${posY - 1}`])  // Neighbor to the lower left 
                    }
                }
                if (posY > 0) {
                    this.addNeighbor(newNode, this.nodes[`${posX}/${posY - 1}`])  // Neighbor to the bottom
                }

                posY++;
            }

            posX++;
        }

        this.startNodeId = `${startNodeX}/${startNodeY}`;
        this.endNodeId = `${endNodeX}/${endNodeY}`;

        this.timestamps.createFlatmap = Date.now() - startTime;
    }

    getRoute() {
        let startTime = Date.now();
        // An implementation of Dijkstra's
        let vm = this;

        if (vm.endPoint.x > vm.startPoint.x) {
            let tempPoint = vm.startPoint;
            let tempNode = vm.startNodeId;
            vm.startPoint = vm.endPoint;
            vm.startNodeId = vm.endNodeId;
            vm.endPoint = tempPoint;
            vm.endNodeId = tempNode;
        }

        return new Promise(function (resolve) {
            let dist = {};
            let prev = {};
            let queue = new BinaryHeap(); 

            dist[vm.startNodeId] = 0;

            // Init all distances to infinity, or -1 in this case
            for (let node of Object.keys(vm.nodes)) {
                let nodeId = vm.nodes[node].id
                if (nodeId !== vm.startNodeId) {
                    dist[nodeId] = Infinity;
                    prev[nodeId] = undefined;
                }
                queue.insert(node, dist[nodeId])
            }

            while (!queue.isEmpty()) {
                let u = queue.extractMin();

                for (let neighbor of vm.neighbors[u[0]]) {
                    let alt = dist[u[0]] + (neighbor.calories * neighbor.gradeFactor);
                    if (alt < dist[neighbor.node]) {
                        dist[neighbor.node] = alt;
                        prev[neighbor.node] = u[0];
                        queue.decreasePriority(neighbor.node, alt);
                    }
                }
            }

            let path = [
                [vm.endPoint.x, vm.endPoint.y],
                [vm.nodes[vm.endNodeId].x, vm.nodes[vm.endNodeId].y]
            ];
            let lastStep = vm.endNodeId;
            vm.route.distance = 0;
            vm.route.calories = 0;

            while (lastStep !== vm.startNodeId) {
                path.unshift([
                    vm.nodes[prev[lastStep]].x, vm.nodes[prev[lastStep]].y
                ]);

                // Add distance and calorie metrics
                let neighbor = vm.neighbors[lastStep].find(n => n.node = prev[lastStep]);

                vm.route.distance += neighbor.distance;
                vm.route.calories += neighbor.calories;
                lastStep = prev[lastStep];
            }

            path.unshift([vm.startPoint.x, vm.startPoint.y]);

            vm.route.eta = vm.route.distance / 1.34112;  // in seconds
            vm.route.elevationDelta = (vm.nodes[vm.endNodeId].elevation - vm.nodes[vm.startNodeId].elevation) / 3.2808;

            vm.route.path = path;

            vm.timestamps.createRoute = Date.now() - startTime;

            resolve(path);  
        })
    }

    getRouteInfo() {
        return {
            distance: this.route.distance,
            eta: this.route.eta,
            calories: this.route.calories,
            elevationDelta: this.route.elevationDelta,
            timestamps: this.timestamps
        };
    }

    async getNodeElevations(requests) {
        let startTime = Date.now();
        let elevations = {};
        let vm = this;

        return axios.all(requests)
        .then(axios.spread(function (...responses) {
            for (let response of responses) {
                let data = response.data['USGS_Elevation_Point_Query_Service']['Elevation_Query'];
                elevations[`${data.x}/${data.y}`] = data.Elevation;
            }

            vm.timestamps.getElevation = Date.now() - startTime;

            return elevations;
        })).catch(errors => {
            console.error('There was an error getting the elevations for the flat map.', errors);
        });
    }

    // https://www.geonames.org/export/codes.html
    // async getNodeTerrains(requests) {
    //     // Make sure the node is on traversable land (i.e. not water, volcano, tar pit, etc.)
    //     let vm = this;

    //     let startTime = Date.now();   

    //     axios.all(requests)
    //     .then(axios.spread(function (...responses) {
    //         for (let response of responses) {
    //             let terrain = response.data.geonames[0].fcodeName;
    //             let index = vm.nodes.findIndex(n => n.x === data.x && n.y === data.y);

    //             // If terrain is not traversable, remove node from graph
    //             vm.nodes[index].terrain = terrain;
    //         }
    //         vm.timestamps.getTerrain = Date.now() - startTime;
    //     })).catch(errors => {
    //         console.error('TError getting terrain at point.', errors);
    //     });
    // }

}