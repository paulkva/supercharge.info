import EventBus from "../../util/EventBus";
import Analytics from "../../util/Analytics";
import QueryStrings from "../../common/QueryStrings";
import userConfig from "../../common/UserConfig";
import WayBackAction from "./action/WayBackAction";
import ToggleRangeCircleAllAction from "./action/ToggleRangeCircleAllAction";
import ToggleRangeCircleAction from "./action/ToggleRangeCircleAction";
import CircleRedrawAction from './action/CircleRedrawAction';
import ControlToggleAction from "./action/ControlToggleAction";
import PanZoomAction from "./action/PanZoomAction";
import RoutingAction from "./route/RoutingAction";
import CreateLinkAction from "./action/CreateLinkAction";
import AddCustomMarkerAction from "./action/AddCustomMarkerAction";
import MapView from "./MapView";
import MarkerFactory from "./MarkerFactory";
import FilterControlView from "./FilterControlView";
import RangeControlView from "./RangeControlView";
import RenderControlView from "./RenderControlView";
import RoutingPanel from "./route/RoutingPanel";
import rangeModel from "./RangeModel";
import Sites from "../../site/Sites";
import $ from "jquery";
import "../../lib/jquery.doTimeout";
import MapDefs from "../../../images/map-defs.svg";


export default class MapPage {
    constructor(filterDialog) {
        MapPage.filterControlView = new FilterControlView(filterDialog);
        $.ajax({
            url: MapDefs
        }).done((data) => {
            $("#map-main-content").append(data.documentElement);
        });
        
    }

    /**
     * Note that part of the map page initialization takes place asynchronously (after user acknowledges or blocks
     * geolocation prompt). We use MapPage.initStarted, MapPage.initViewStarted, MapPage.initComplete, MapPage.initViewComplete.
     */
    onPageShow() {
        if (!MapPage.initStarted) {
            this.initialize();
            MapPage.initStarted = true;
        } else {
            MapPage.filterControlView.syncFilters();
        }
        $("#navbar-map-dropdown").show();
    }

    onPageHide() {
        $("#navbar-map-dropdown").hide();
        MarkerFactory.CloseAllOpenUnpinnedInfoWindows();
    }

    initialize() {
        new RenderControlView();
        new RangeControlView();
        new RoutingPanel();
        EventBus.addListener("map-viewport-change-event", this.setInitViewComplete, this);

        const initSite = QueryStrings.isSiteIdSet() ? Sites.getById(QueryStrings.getSiteId()) : null;

        /* CASE 1: User has explicitly specified initial map center via 'Center' URL param. */
        if (QueryStrings.isCenterSet()) {
            this.initializeAtDefault();
            Analytics.sendEvent('map', 'geolocation', 'user-provided-center');
        }
        /* CASE 2: User has explicitly specified a valid site ID */
        else if (initSite !== null) {
            console.log(`initializing map with site ${initSite.id} (${initSite.location.lat},${initSite.location.lng})`);
            this.initializeAt(initSite.location.lat, initSite.location.lng);
            EventBus.dispatch("map-show-location-event", QueryStrings.getSiteId());
        }
        /* CASE 3: We have a location from UserConfig. */
        else if (userConfig.isLocationSet()) {
            console.log(`initializing map with lat/lng from userConfig: ${userConfig.latitude},${userConfig.longitude}`);
            this.initializeAt(userConfig.latitude, userConfig.longitude);
        }
        /* CASE 4: We can get initial map center from geolocation API. */
        else if (navigator.geolocation) {

            /* Some users don't know how to acknowledge geolocation prompt, do it for them after timeout. */
            const mapPage = this;
            $.doTimeout('show-map-anyway', 6000, function () {
                mapPage.initializeAtDefault();
                Analytics.sendEvent('map', 'geolocation', 'timeout');
            });

            const successCallback = $.proxy(this.geoLocationSuccess, this);
            const errorCallback = $.proxy(this.geoLocationError, this);
            navigator.geolocation.getCurrentPosition(successCallback, errorCallback);
        }
        /* CASE 5: geolocation API is not available */
        else {
            this.initializeAtDefault();
            Analytics.sendEvent('map', 'geolocation', 'not-available');
        }
    }

    geoLocationSuccess(position) {
        const newLat = position.coords.latitude;
        const newLng = position.coords.longitude;
        this.initializeAt(newLat, newLng);
    }

    // PositionError: https://developer.mozilla.org/en-US/docs/Web/API/PositionError
    // 1    PERMISSION_DENIED
    // 2    POSITION_UNAVAILABLE
    // 3    TIMEOUT
    geoLocationError(positionError) {
        this.initializeAtDefault();
        Analytics.sendEvent('map', 'geolocation', 'error_' + positionError.code);
    }

    initializeAtDefault() {
        const INITIAL_CENTER = QueryStrings.getCenter();
        this.initializeAt(INITIAL_CENTER.latitude, INITIAL_CENTER.longitude);
    }

    initializeAt(lat, lng) {

        /* Cancel the timeout */
        $.doTimeout('show-map-anyway');

        /* Don't draw twice if timer finishes and THEN user allows geolocation. */
        if (MapPage.initViewStarted) {
            return;
        }
        MapPage.initViewStarted = true;

        let initialZoom = QueryStrings.getZoom();
        if (!QueryStrings.isZoomSet() && userConfig.isZoomSet()) {
            initialZoom = userConfig.zoom;
        }
        this.mapView = new MapView(lat, lng, initialZoom);

        if (!QueryStrings.isRangeUnitSet()) {
            rangeModel.setDisplayUnit(userConfig.getUnit());
        }

        new RoutingAction(this.mapView.mapApi);
        new WayBackAction(this.mapView.mapApi);
        new ToggleRangeCircleAllAction(this.mapView.mapApi);
        new ToggleRangeCircleAction(this.mapView.mapApi);
        new CircleRedrawAction(this.mapApi);
        new ControlToggleAction();
        new PanZoomAction(this.mapView.mapApi);
        new CreateLinkAction(this.mapView.mapApi);
        new AddCustomMarkerAction(this.mapView);

        if (QueryStrings.getWayBack()) {
            EventBus.dispatch("way-back-trigger-event");
        }

        MapPage.initComplete = true;
    }

    setInitViewComplete() {
        MapPage.initViewComplete = true;
    }

}
