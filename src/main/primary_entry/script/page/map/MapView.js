import EventBus from "../../util/EventBus";
import Analytics from "../../util/Analytics";
import userConfig from "../../common/UserConfig";
import SiteIterator from "../../site/SiteIterator";
import SitePredicates from "../../site/SitePredicates";
import SiteSorting from "../../site/SiteSorting";
import Sites from "../../site/Sites";
import MapContextMenu from "./context/MapContextMenu";
import MarkerFactory from "./MarkerFactory";
import $ from "jquery";
import L from 'leaflet';
import 'leaflet-control-geocoder';
import mapLayers from './MapLayers';
import RouteEvents from "./route/RouteEvents";
import routeResultModel from './route/RouteResultModel';
import polyline from '@mapbox/polyline';
import renderModel from "./RenderModel";
import MapEvents from "./MapEvents";
import TotalCountPanel from "../../nav/TotalCountPanel";

export default class MapView {

    constructor(lat, lng, initialZoom) {
        this.pinnedSites = [];

        this.initMap(lat, lng, initialZoom);
        this.zoom = initialZoom;
        this.markerType = "Z";
        this.markerSize = 10;
        this.wayBackActive = false;
        this.addCustomMarkers();

        $(document).on('click', '.marker-toggle-trigger', $.proxy(this.handleMarkerRemove, this));
        $(document).on('click', '.marker-toggle-all-trigger', $.proxy(this.handleMarkerRemoveAll, this));

        // this works around stacking context issues with Leaflet controls (zoom, layers, search)
        // which would otherwise appear on top of filter dropdowns
        $(document).on('show.bs.select', $.proxy(this.hideLeafletControls, this));
        $(document).on('hide.bs.select', $.proxy(this.showLeafletControls, this));
        
        // this works around a bug related to the navbar expand/collapse animation on mobile
        $('#navbar').on('hidden.bs.collapse', $.proxy(this.handleViewportChange, this));

        //
        // Map context menu
        //
        new MapContextMenu(this.mapApi);
        EventBus.addListener("way-back-trigger-event", this.setupForWayBack, this);
        EventBus.addListener("way-back-cleanup-event", this.cleanupWayBack, this);
        EventBus.addListener(RouteEvents.result_model_changed, this.handleRouteResult, this);
        EventBus.addListener("viewport-changed-event", this.handleViewportChange, this);
        EventBus.addListener("markersize-changed-event", this.updateMarkerSize, this);
        EventBus.addListener("remove-all-markers-event", this.removeAllMarkers, this);
        EventBus.addListener("zoom-to-site-event", this.handleZoomToSite, this);
        EventBus.addListener("pin-site-event", this.pinSite, this);
        EventBus.addListener("unpin-sites-event", this.unpinSites, this);
        
        this.mapApi.on('moveend', $.proxy(this.handleViewportChange, this));

        // draw map for first time.
        this.handleViewportChange();

        // fixes leaflet and webpack not playing nice
        // https://github.com/PaulLeCam/react-leaflet/issues/453#issuecomment-761806673
        delete L.Icon.Default.prototype._getIconUrl;
        L.Icon.Default.mergeOptions({
            iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
            iconUrl: require('leaflet/dist/images/marker-icon.png'),
            shadowUrl: require('leaflet/dist/images/marker-shadow.png')
        });

        // Uncomment for debugging region/country bounds
        //Object.values(TotalCountPanel.ALL).forEach(bounds => {
        //    L.rectangle(bounds, { color: "#ff7800", weight: 1}).addTo(this.mapApi);
        //});
    }

    //- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
    // Getter/Setter
    //- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

    /**
     * Delegates to this.mapApi and returns { lat: , lng: } coordinate, but accounting for a weird behavior in
     * the maps API: If the user pans around the globe this.mapApi.getCenter() will return lng values
     * outside of [-180, 180]. Here we takes steps to ensure that the longitude value returned for center is always
     * in [-180,180].
     *
     * Note that this.mapApi.getBounds().getCenter() returns a lng that is always in [-180,180] but for some
     * reason the latitude returned by the function does not exactly equal the current center latitude.  If
     * we use a latitude value that is slightly off each time the map moves up each time the user visits.
     */
    getCenter() {
        return this.mapApi.getCenter().wrap();
    }

    //- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
    // Initialization
    //- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

    /**
     * Initialize map
     */
    initMap(initialLat, initialLng, initialZoom) {

        // map API
        //
        this.mapApi = L.map('map-canvas', {
            center: [initialLat, initialLng],
            zoom: initialZoom,
            zoomSnap: 1,
            zoomDelta: 1,
            layers: mapLayers.getInitialLayers(),
            preferCanvas: false,
            maxBounds: TotalCountPanel.WORLD,
            maxBoundsViscosity: 0,
            worldCopyJump: true
        });

        const mapApi = this.mapApi;
        $(".leaflet-top.leaflet-left").append(L.DomUtil.create("div", "leaflet-control leaflet-zoom-control zoom-label fade"));
        const zoomLabel = $(".zoom-label");

        const zoomInControl = $(".leaflet-control-zoom-in"), zoomOutControl = $(".leaflet-control-zoom-out");
        zoomInControl.tooltip({ placement: "right" }); zoomOutControl.tooltip({ placement: "right" });
        zoomInControl.attr("data-original-title", "Zoom in • (shift: 3x)");
        zoomOutControl.attr("data-original-title", "Zoom out • (shift: 3x)");

        // dim markers and show zoom level indicator in bottom-left while zooming
        const markerPane = this.mapApi.createPane('markers');
        this.mapApi.on('zoomstart', function (e) {
            if (typeof window.zlt !== "undefined") clearTimeout(window.zlt);
            markerPane.style.opacity = 0.2;
            var zoomLevel = Math.floor(mapApi.getZoom() * 100) / 100;
            zoomLabel.html("Z<br/>" + zoomLevel);
            zoomLabel.removeClass("fade");
        });
        this.mapApi.on('zoomend', function (e) {
            var zoomLevel = Math.floor(mapApi.getZoom() * 100) / 100;
            zoomLabel.html("Z<br/>" + zoomLevel);
            if (typeof window.zlt !== "undefined") clearTimeout(window.zlt);
            window.zlt = setTimeout(function () { zoomLabel.addClass("fade"); }, 2000);
            markerPane.style.opacity = 1;
        });

        this.mapApi.on('baselayerchange', function (e) {
            this.layerName = e.name;
            this.layerOptions = e.layer.options;
            this.setMaxZoom(this.layerOptions.maxZoom);
            this.setMinZoom(this.layerOptions.minZoom);
        });

        // layers control
        //
        L.control.layers(mapLayers.getBaseMaps(), mapLayers.getOverlayMaps()).addTo(this.mapApi);

        // geocode (search) control
        //
        L.Control.geocoder({
            iconLabel: "Address Search",
            placeholder: "Address Search",
            showResultIcons: false
        }).addTo(this.mapApi);

        $(".leaflet-control-geocoder button").tooltip({ placement: "left", title: "Address Search - enter address to find on the map" });

        // scale control TODO: update scale unit when user changes it on profile/UI.
        //
        L.control.scale({
            metric: userConfig.getUnit().isMetric(),
            imperial: !userConfig.getUnit().isMetric(),
            updateWhenIdle: true
        }).addTo(this.mapApi);

        // marker factory
        //
        this.markerFactory = new MarkerFactory(this.mapApi);
    }

    /**
     * Add custom markers from user config to the map.
     */
    addCustomMarkers() {
        const customMarkers = userConfig.customMarkers;
        for (let i = 0; i < customMarkers.length; i++) {
            const cm = customMarkers[i];
            Sites.addCustomSite(cm.name, L.latLng(cm.lat, cm.lng));
        }
    }

    //- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
    // Drawing
    //- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

    handleViewportChange() {
        this.mapApi.invalidateSize();
        const latLngBounds = this.mapApi.getBounds();
        const northEast = latLngBounds.getNorthEast();
        const southWest = latLngBounds.getSouthWest();
        const newNorthEast = L.latLng(northEast.lat + 1, northEast.lng + 2);
        const newSouthWest = L.latLng(southWest.lat - 1, southWest.lng - 2);
        const expandedBounds = L.latLngBounds(newSouthWest, newNorthEast);

        if (this.mapApi.layerName === "USGS Imagery+Topo" && !TotalCountPanel.USA.contains(latLngBounds)) {
            this.mapApi.setMaxZoom(8);
        } else if (this.mapApi.layerOptions?.maxZoom) {
            this.mapApi.setMaxZoom(this.mapApi.layerOptions.maxZoom);
        }

        if (this.wayBackActive) return;

        var oldMarkerType = this.markerType;
        this.markerType = renderModel.markerType;
        var oldZoom = this.zoom;
        this.zoom = this.mapApi.getZoom();

        // clean up InfoWindows when switching between clustered and non-clustered
        if ((this.markerType === "C") !== (oldMarkerType === "C")) {
            MarkerFactory.CloseAllOpenUnpinnedInfoWindows();
            this.removeAllMarkers(false);
        }

        if (this.markerType === "C") {
            this.createClusteredMarkers(expandedBounds, oldZoom);
        } else if (this.markerType === "Z") {
            var newMarkerSize = this.getMarkerSizeByZoom(this.zoom);
            this.createIndividualMarkers(expandedBounds, newMarkerSize);
        } else {
            // markerType represents a fixed marker size (4-10)
            this.createIndividualMarkers(expandedBounds, renderModel.getCurrentMarkerSize());
        }

        EventBus.dispatch("map-viewport-change-event", latLngBounds);

        const mapCenter = this.getCenter();
        userConfig.setLatLngZoom(mapCenter.lat, mapCenter.lng, this.zoom);

        var resultCount = new SiteIterator()
                .withPredicate(SitePredicates.buildInViewPredicate(L.latLngBounds(southWest, northEast)))
                .withPredicate(SitePredicates.buildUserFilterPredicate(userConfig.filter))
                .count();

        var resultSpan = $("#map-result-count");
        resultSpan.html(`<span class="shrink">Showing </span>${resultCount.toLocaleString()} site${resultCount === 1 ? "" : "s"}`);
        resultSpan.attr("class", resultCount === 0 ? "zero-sites" : "site-results");
        resultSpan.attr("title", resultCount === 0 ? "No sites displayed. Adjust or reset filters, zoom out, or move the map to see more." : "");
    }

    removeAllMarkers(saveInfoWindows) {
        var t = performance.now(), removed = 0, infoWindows = [];
        if (saveInfoWindows) {
            // get all open unpinned InfoWindows
            new SiteIterator()
                .withPredicate(SitePredicates.HAS_SHOWN_UNPINNED_INFO_WINDOW)
                .iterate((s) => {
                    //console.log("saving info for site " + s.id);
                    infoWindows.push(s.marker.infoWindow);
                });
        }
        // Remove markers from Leaflet
        $(".leaflet-marker-icon").remove();
        // Remove markers from the supercharger objects themselves
        new SiteIterator()
        .withPredicate(SitePredicates.HAS_MARKER)
        .iterate((supercharger) => {
            if (!supercharger.marker.infoWindow?.isPinned()) {
                supercharger.marker.infoWindow?.closeWindow();
                supercharger.marker.remove();
                supercharger.marker = null;
                removed++;
            }
        });
        console.log(`zoom=${this.zoom} removed=${removed} t=${(performance.now() - t)}`);
        return infoWindows;
    }

    restoreInfoWindows(infoWindows) {
        for (const iw of infoWindows) {
            const s = iw.site, m = iw.marker;
            if (s.marker === null) {
                iw.closeWindow();
            } else if (s.marker !== m) {
                s.marker.infoWindow = iw;
                iw.showWindow();
            } else {
                iw.showWindow();
            }
        }
    }

    getMarkerSizeByZoom = (zoom) => zoom < 4 ? 4 : zoom > 16 ? 10 : Math.ceil(zoom / 2) + 2;

    pinSite(event, supercharger) {
        if (supercharger.marker === null || supercharger.marker === undefined) {
            if (this.pinnedSites.indexOf(supercharger) < 0) this.pinnedSites.push(supercharger);
            this.markerFactory.createMarker(supercharger, this.markerSize, false);
        }
        supercharger.marker.fire('click');
        $.doTimeout('pinSite', 10, () => {
            supercharger.marker.infoWindow.pinned = true;
            supercharger.marker.infoWindow.redraw();
        });
    }

    unpinSites() {
        for (const s of this.pinnedSites) {
            s.marker.infoWindow.pinned = false;
            s.marker.infoWindow.redraw();
        }
        this.pinnedSites = [];
    }

    createIndividualMarkers(bounds, newMarkerSize) {
        var t = performance.now(), created = 0, infoWindows = [];
        if (this.markerSize !== newMarkerSize) {
            this.updateMarkerSize(newMarkerSize);
        }
        const markers = [];
        new SiteIterator()
            .withPredicate(SitePredicates.HAS_NO_MARKER)
            .withPredicate(SitePredicates.buildInViewPredicate(bounds))
            .withPredicate(SitePredicates.buildUserFilterPredicate(userConfig.filter))
            .withSort(SiteSorting.BY_STATUS_DAYS_DESC) // show open above constr, constr above permit, and newest sites on top within each status
            .iterate((supercharger) => {
                markers.push(this.markerFactory.createMarker(supercharger, newMarkerSize, true));
                created++;
            });
        this.pinnedSites.forEach((supercharger) => {
            if (supercharger.marker === null || supercharger.marker === undefined) {
                markers.push(this.markerFactory.createMarker(supercharger, newMarkerSize, true));
                created++;
            }
        });
        mapLayers.addGroupToOverlay(markers);
        this.restoreInfoWindows(infoWindows);
        console.log(`zoom=${this.zoom} created=${created} markers=${newMarkerSize} t=${(performance.now() - t)}`);
    }

    createClusteredMarkers(bounds, oldZoom) {
        var t = performance.now(), newZoom = this.zoom, created = 0, infoWindows = [];
        // Cluster aggressively through zoom level 8, then much less aggressively from 9 to 14, then not at all for 15+
        const overlapRadius = [
            5, 3.2, 1.6, 0.8, 0.4,
            0.18, 0.11, 0.08, 0.035, 0.012,
            0.004, 0.002, 0.001, 0.0005, 0.0001,
            0, 0, 0, 0, 0, 0, 0, 0, 0
        ];
        this.updateMarkerSize(8);
        if (oldZoom !== newZoom) {
            // clear old cluster markers when zooming in/out
            infoWindows = this.removeAllMarkers(true);
        }
        const radius = overlapRadius[Math.floor(this.zoom)] * renderModel.getCurrentClusterSize();
        const markers = [];
        new SiteIterator()
            .withPredicate(SitePredicates.HAS_NO_MARKER)
            .withPredicate(SitePredicates.buildInViewPredicate(bounds))
            .withPredicate(SitePredicates.buildUserFilterPredicate(userConfig.filter))
            .withSort(SiteSorting.BY_STATUS_DAYS_DESC) // same sort as createIndividualMarkers() but imperfect due to clustering
            .iterate((s1) => {
                if (s1.marker === null || s1.marker === undefined) { // gotta check again because one site might set another site's marker
                    var overlapSites = [s1];
                    const s1Lat = s1.location.lat, s1Lng = s1.location.lng;
                    var s1Bounds = L.latLngBounds(L.latLng(s1Lat - radius, s1Lng - radius), L.latLng(s1Lat + radius, s1Lng + radius));
                    new SiteIterator()
                        .withPredicate(SitePredicates.buildInViewPredicate(s1Bounds))
                        .withPredicate(SitePredicates.buildUserFilterPredicate(userConfig.filter))
                        .iterate((s2) => {
                            if (s1 !== s2 && s1.status === s2.status && ((s2.marker === null || s2.marker === undefined)) && overlapSites.length < 999) {
                                var x = s1Lat - s2.location.lat, y = s1Lng - s2.location.lng, dist = Math.sqrt(x*x + y*y);
                                if (dist > 0 && dist < radius) {
                                    overlapSites.push(s2);
                                }
                            }
                        });
                    markers.push(this.markerFactory.createMarkerCluster(overlapSites, this.zoom, true));
                    created++;
                }
            });
        
        this.pinnedSites.forEach((supercharger) => {
            if (supercharger.marker === null || supercharger.marker === undefined) {
                markers.push(this.markerFactory.createMarker(supercharger, this.markerSize, true));
                created++;
            }
        });

        mapLayers.addGroupToOverlay(markers);
        this.restoreInfoWindows(infoWindows);
        console.log(`zoom=${newZoom} created=${created} clusters=${renderModel.getCurrentClusterSize()} t=${(performance.now() - t)}`);
    }

    updateMarkerSize(markerSize) {
        this.markerSize = markerSize;
        new SiteIterator()
            .withPredicate(SitePredicates.HAS_MARKER)
            .iterate((supercharger) => {
                if (supercharger.marker.setRadius) supercharger.marker.setRadius(markerSize * supercharger.getMarkerMultiplier());
            });
        var samples = $(".sample-markers img");
        samples.width(markerSize * 2);
        samples.height(markerSize * 2);
    }

    setupForWayBack() {
        this.prevUserConfig = JSON.stringify(userConfig);
        this.wayBackActive = true;
        this.zoom = 3;
        renderModel.setMarkerType("Z");
        this.updateMarkerSize(this.getMarkerSizeByZoom(3));
        this.removeAllMarkers(false);
        this.handleViewportChange();
        /* Initialize all markers */
        const markerFactory = this.markerFactory;
        new SiteIterator()
            .iterate((supercharger) => markerFactory.createMarker(supercharger, this.markerSize, true));
        EventBus.dispatch("way-back-start-event");
    }

    cleanupWayBack() {
        this.wayBackActive = false;
        this.removeAllMarkers(false);
        userConfig.initFilters();
        userConfig.initShowAlways();
        userConfig.fromJSON(JSON.parse(this.prevUserConfig));
        this.zoom = userConfig.zoom;
        renderModel.setMarkerType(this.markerType);
        this.updateMarkerSize(userConfig.markerSize);
        this.handleViewportChange();
    }

    handleRouteResult() {
        // We can only display one route at a time, so in any case, remove the existing line on a route model update.
        if (this.routeLine) {
            this.routeLine.removeFrom(this.mapApi);
            this.routeLine.remove();
            this.routeLine = null;
        }
        if (!routeResultModel.isEmpty()) {
            const geomString = routeResultModel.getBestRoute().geometry;
            const geomArray = polyline.decode(geomString);
            this.routeLine = L.polyline(geomArray, {
                color: '#3388ff',
                weight: 6,
                opacity: 0.75
            }).addTo(this.mapApi);
            this.mapApi.fitBounds(this.routeLine.getBounds());
        }
    }

    // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
    // InfoWindow Event handlers
    // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

    handleZoomToSite(event, data) {
        const newZoom = (this.zoom > 14 && this.zoom < 19 ? 19 : 15);
        EventBus.dispatch(MapEvents.pan_zoom, { latLng: data.site.location, zoom: newZoom });
    }

    handleMarkerRemove(event) {
        event.preventDefault();
        if (!confirm("Remove this custom marker? This cannot be undone.")) return;
        const id = parseInt($(event.target).attr('href'));
        const site = Sites.getById(id);
        this.removeCustomMarker(site);
        Analytics.sendEvent("route", "remove-custom-marker");
    }

    handleMarkerRemoveAll(event) {
        event.preventDefault();
        if (!confirm("Remove ALL custom markers? This cannot be undone.")) return;
        const toRemoveList = [];
        new SiteIterator()
            .withPredicate(SitePredicates.USER_ADDED)
            .iterate(function (site) {
                    toRemoveList.push(site);
                }
            );
        for (let i = 0; i < toRemoveList.length; i++) {
            this.removeCustomMarker(toRemoveList[i]);
        }
        Analytics.sendEvent("route", "remove-custom-marker");
    }

    removeCustomMarker(site) {
        if (site.marker) {
            if (site.marker.popup) {
                site.marker.popup.remove();
            }
            site.marker.remove();
        }
        if (site.circle) {
            site.circle.remove();
        }
        Sites.removeById(site.id);
        userConfig.removeCustomMarker(site.displayName, site.location.lat, site.location.lng);
        userConfig.removeCustomMarker(site.displayName, site.location.lat, site.location.lng);
    }

    hideLeafletControls() {
        $('.leaflet-control-container').addClass('hidden');
    }
    showLeafletControls() {
        $('.leaflet-control-container').removeClass('hidden');
    }
}
