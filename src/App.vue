<template>
  <div id="app">
    <div class="columns">
      <div class="column is-2">
        <aside class="menu">
          <h5 class="menu-title">Settings</h5>
          <p class="menu-label">Display</p>
          <ul class="menu-list">
            <li><label class="checkbox"><input type="checkbox" v-model="showBoundingBox" @change="showBoundingBox ? addBoundingBox() : removeBoundingBox()"> Show bounding box</label></li>
            <li><label class="checkbox"><input type="checkbox" v-model="showFlatmap" @change="showFlatmap ? addFlatmap() : removeFlatmap()"> Show flatmap</label></li>
          </ul>
          <p class="menu-label">Route Parameters</p>
          <ul class="menu-list">
            <li>
              <div class="field is-horizontal">
                <div class="field-label is-small">
                  <label class="label">Max Incline</label>
                </div>
                <div class="field-body">
                  <div class="field">
                    <p class="control">
                      <input class="input is-small" type="number" max="1" min="0" v-model="maxIncline" placeholder="0.5">
                    </p>
                  </div>
                </div>
              </div>
            </li>
            <li>
              <div class="field is-horizontal">
                <div class="field-label is-small">
                  <label class="label">Max Decline</label>
                </div>
                <div class="field-body">
                  <div class="field">
                    <p class="control">
                      <input class="input is-small" type="number" max="0" min="-1" v-model="maxDecline" placeholder="-0.5">
                    </p>
                  </div>
                </div>
              </div>
            </li>
          </ul>
          <br>
          <h5 class="menu-title">Metrics</h5>
          <p class="menu-label">Performance</p>
          <ul class="menu-list">
            <li>Create Bounding Box: {{ timestamps.createBoundingBox }} ms</li>
            <li>Create Flatmap: {{ timestamps.createFlatmap || '--' }} ms</li>
            <li>Create Route: {{ timestamps.createRoute || '--' }} ms</li>
            <li>Get Elevation: {{ timestamps.getElevation || '--' }} ms</li>
            <li>Get Terrain: {{ timestamps.getTerrain || '--' }} ms</li>
            <li>Total Time: {{ timestamps.createBoundingBox + timestamps.createFlatmap + timestamps.createRoute || '--' }} ms</li>
          </ul>
          <p class="menu-label">Map Details</p>
          <ul class="menu-list">
            <li># of nodes: {{ terrainMap ? terrainMap.numNodes : '--' }}</li>
            <li># of edges: {{ terrainMap ? terrainMap.numEdges : '--' }}</li>
          </ul>
        </aside>
      </div>
      <div class="column is-10">
        <div class="main">
          <div class="content">
            <h1>Overland Pathfinder</h1>
            <p>
              Find a route where there are no roads. Verify the settings on the left, then click on two points
              on the map to plot a route. (Try and keep the route short, API calls to get elevations are limited)
            </p>
          </div>

          <div class="box map-container">
            <div class="map" ref="map"></div>
            <div v-if="isLoading" class="loading">Calculating route...</div>
          </div>

          <div class="content">
            <p class="help has-text-centered">🛠️  by Adam Gaudreau</p>
            <p class="help has-text-centered">Map powered by <a href="https://www.esri.com/en-us/home" target="_blank">Esri</a> | Elevation data provided by <a href="https://www.usgs.gov/core-science-systems/national-geospatial-program/national-map" target="_blank">USGS</a> | Terrain data provided by <a href="https://www.geonames.org/" target="_blank">GeoNames</a></p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { loadModules } from 'esri-loader';
import TerrainMap from '../lib/terrainMap';

export default {
  name: 'App',
  data() {
    return {
      ArcGISMap: {},
      MapView: {},
      Graphic: {},

      view: {},
      terrainMap: undefined,
      currentPoint: {},
      startPoint: {},
      endPoint: {},
      routeDetails: '',
      timestamps: {},

      isLoading: false,
      showBoundingBox: true,
      boundingBox: undefined,
      showFlatmap: true,
      flatmap: [],
      maxIncline: 0.5,
      maxDecline: -0.5
    }
  },
  mounted() {
    let vm = this;

    loadModules(['esri/Map', 'esri/views/MapView', 'esri/Graphic'], { css: true })
    .then(async ([ArcGISMap, MapView, Graphic]) => {
      vm.ArcGISMap = ArcGISMap;
      vm.MapView = MapView;
      vm.Graphic = Graphic;

      vm.createMap();
      vm.createMapEventListeners();
    });
  },
  methods: {

    createMap() {
      let vm = this;
      const map = new vm.ArcGISMap({
        basemap: 'topo',
      });

      vm.view = new vm.MapView({
        container: vm.$refs.map,
        map: map,
        center: [-118, 34],
        zoom: 17 // 8
      });
    },

    createMapEventListeners() {
      let vm = this;

      vm.view.on("pointer-move", function (event) {
        let points = vm.view.toMap({ x: event.x, y: event.y });
        vm.currentPoint = { x: points.longitude, y: points.latitude }
      });

      vm.view.on('click', function() {
        if (vm.view.graphics.length === 0) {
          // There are no points on the map, so place the start marker
          vm.createMapMarker('start', vm.currentPoint);
          vm.startPoint = vm.currentPoint;
        } else if (vm.view.graphics.length === 1) {
          // Start marker already placed, place the end marker
          vm.createMapMarker('finish', vm.currentPoint);
          vm.endPoint = vm.currentPoint;

          // Since both points are placed, we can initiate the best-path route search
          vm.makeRoute();
        } else {
          // Start and end markers placed, so clear both and set start marker
          vm.view.graphics.removeAll();
          vm.createMapMarker('start', vm.currentPoint);
          vm.startPoint = vm.currentPoint;
          vm.endPoint = {}
        }
      });
    },

    createMapMarker(type, point) {
      let vm = this;
      let graphic = new vm.Graphic({
        symbol: {
          type: 'simple-marker',
          color: (type === 'start') ? 'white' : 'black',
          size: '8px'
        },
        geometry: {
          type: 'point',
          longitude: point.x,
          latitude: point.y
        }
      });

      vm.view.graphics.add(graphic);
    },

    addBoundingBox() {
      let vm = this;
      vm.boundingBox = new vm.Graphic({
          geometry: {
            type: "polyline",
            paths: [
              vm.terrainMap.boundingBox.topLeft, vm.terrainMap.boundingBox.topRight, 
              vm.terrainMap.boundingBox.bottomRight, vm.terrainMap.boundingBox.bottomLeft,
              vm.terrainMap.boundingBox.topLeft
            ]
          },
          symbol: {
            type: "simple-line",
            color: [220, 35, 24], 
            width: 1,
            style: 'dot'
          }
        });

        vm.view.graphics.add(vm.boundingBox);
    },

    removeBoundingBox() {
      this.view.graphics.remove(this.boundingBox);
      this.boundingBox = undefined;
    },

    addFlatmap() {
      let vm = this;
      for (let node of Object.keys(vm.terrainMap.nodes)) {
        let newNode = new vm.Graphic({
          geometry: {
            type: 'point',
            longitude: vm.terrainMap.nodes[node].x,
            latitude: vm.terrainMap.nodes[node].y
          },
          symbol: {
            type: 'simple-marker',
            color: [0, 0, 0],
            size: '2px'
          }
        });

        vm.flatmap.push(newNode);
        vm.view.graphics.add(newNode);
      }
    },

    removeFlatmap() {
      for (let node of this.flatmap) this.view.graphics.remove(node);
      this.flatmap = [];
    },

    async makeRoute() {
      let vm = this;
      vm.isLoading = true;

      vm.terrainMap = new TerrainMap(vm.startPoint, vm.endPoint, vm.maxIncline, vm.maxDecline);
      await vm.terrainMap.generateFlatmap();
      let route = await vm.terrainMap.getRoute();
      vm.isLoading = false;

      // Display bounding box
      if (vm.showBoundingBox) vm.addBoundingBox();
      
      // Display flat map nodes
      if (vm.showFlatmap) vm.addFlatmap();

      // Add route information to map
      let details = vm.terrainMap.getRouteInfo();

      if (!vm.routeDetails) {
        vm.routeDetails = document.createElement("div");
        vm.routeDetails.id = "coordsWidget";
        vm.routeDetails.className = "esri-widget esri-component";
        vm.routeDetails.style.padding = "7px 15px 5px";

        vm.view.ui.add(vm.routeDetails, "top-right");
      }

      vm.routeDetails.innerHTML = `
        <b>Route Details</b> <br>
        Total distance: ${(details.distance / 1000).toFixed(3)} km <br>
        ETA: ${Math.floor(details.eta / 60)}m ${Math.ceil(details.eta % 60)}s <br>
        Elev. delta: ${details.elevationDelta >= 0 ? '+' : ''}${Math.ceil(details.elevationDelta)}m
      `;

      // Display route
      let routeGraphic = new vm.Graphic({
        geometry: {
          type: "polyline",
          paths: route
        },
        symbol: {
          type: "simple-line",
          color: [34, 168, 230], 
          width: 2
        }
      });

      vm.view.graphics.add(routeGraphic);

      vm.timestamps = details.timestamps;
    }

  },
  beforeDestroy() {
    if (this.view) {
      // destroy the map view
      this.view.destroy();
    }
  }
}
</script>

<style>
html, body {
  height: 100vh;
  width: 100vw;
  background-color: #121212;
}

h1, p, label, li {
  color: white !important;
}

.loading {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  width: 100%;
  background: rgba(0, 0, 0, .7);
  color: white;
  font-size: 1.5em;
  font-weight: 700;
  line-height: 800px;
  text-align: center;
}

.menu {
  height: 100%;
  width: 100%;
  padding: 16px;
  background-color: #1e1e1e;
}
.menu-title {
  color: white;
  font-size: 2em;
}

.field-label {
  text-align: left;
  flex-grow: 3;
}
.field {
  margin-bottom: 5px;
}

.box {
  background-color: #1e1e1e !important;
}

.main {
  padding: 40px 0;
  padding-right: 30px;
}

.map-container {
  position: relative;
  width: 100%;
  height: 800px;
}
.map {
  position: absolute;
  top: 0;
  left: 0;
  padding: 0;
  margin: 0;
  width: 100%;
  height: 100%;
}
</style>
