import Objects from "../../../util/Objects";
import Analytics from "../../../util/Analytics";
import rangeModel from "../RangeModel";
import $ from "jquery";
import L from "leaflet";
import dayjs from "dayjs";
import ServiceURL from "../../../common/ServiceURL";
import EventBus from "../../../util/EventBus";
import buildDetailsDiv from "./DetailsTableRenderer";
import "./InfoWindowListeners";

/**
 * One of these is created each time a marker is clicked.
 */
export default class InfoWindow {

    constructor(mapApi, marker, site) {
        var relativeTime = require('dayjs/plugin/relativeTime');
        dayjs.extend(relativeTime);

        // reference fields
        this.marker = marker;
        this.site = site;
        this.mapApi = mapApi;

        // state fields
        this.popup = null;
        this.showDetails = site.isUserAdded();
        this.showHistory = false;
        this.pinned = false;

        // Download history
        if (site.historyLoaded !== true) {
            $.getJSON(ServiceURL.SITE_HISTORY, { siteId: site.id })
                .done((h) => {
                    if (!h || !h.length) {
                        return;
                    } else if (Objects.isNullOrUndef(site.history) || site.history.length < 1) {
                        // no adjustment needed if history is null or empty
                    } else if (site.history[0].siteStatus != h[0].siteStatus && new Date(site.history[0].date) < new Date(h[0].date)) {
                        h.unshift(site.history[0]);
                    } else if (site.history[0].siteStatus != h[h.length - 1].siteStatus && new Date(site.history[0].date) > new Date(h[h.length - 1].date)) {
                        h.push(site.history[0]);
                    }
                    site.history = h;
                    site.historyLoaded = true;
                });
        }
    }

    isPinned() {
        return this.pinned;
    }

    isShown() {
        return this.popup !== null;
    }

    showWindow() {
        if (this.popup === null) {
            this._initializePopup();
        }
    }

    closeWindow() {
        if (this.popup !== null) {
            this.popup.remove();
        }
        this._resetStateToClosed();
    }

    redraw() {
        this.popup.setContent(this._buildHtmlContent());
        this.initTooltips();
    }

    initTooltips() {
        $(".tooltip").tooltip("hide");
        $(".info-window-content a, .info-window-content img, .info-window-content span").each(function (n, t) {
            $(t).tooltip({ "container": "body" });
        });
    }

    toggleDetails(showDetails) {
        if (Objects.isNotNullOrUndef(showDetails)) {
            this.showDetails = showDetails;
        } else {
            this.showDetails = !this.showDetails;
        }

        if (this.showDetails) {
            Analytics.sendEvent("map", "view-marker-details");
        }
    }

    toggleHistory(showHistory) {
        if (Objects.isNotNullOrUndef(showHistory)) {
            this.showHistory = showHistory;
        } else {
            this.showHistory = !this.showHistory;
        }

        if (this.showHistory) {
            Analytics.sendEvent("map", "view-marker-history");
        }
    }

    togglePin(event) {
        this.pinned = !this.pinned;
        if (this.isPinned()) {
            $(event.target).removeClass('pin');
            $(event.target).addClass('unpin');
        } else {
            $(event.target).removeClass('unpin');
            $(event.target).addClass('pin');
        }
        if (this.pinned) {
            Analytics.sendEvent("map", "pin-marker");
        }
    }

    // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
    // private
    // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

    _resetStateToClosed() {
        this.popup = null;
        this.pinned = false;
    }

    _initializePopup() {
        // Ideally we would add the popup to a layer group here instead of a map so that it
        // appears and disappears when changing layers. Doesn't seem possible currently through
        // leaflet API.
        this.popup = L.popup({autoClose: false, closeOnClick: false})
            .setLatLng(this.site.location)
            .setContent(this._buildHtmlContent())
            .openOn(this.mapApi);
        this.mapApi.on('popupclose', this._handleMapApiPopupCloseEvent, this);
        this.marker.popup = this.popup;
        this.initTooltips();
    }

    _handleMapApiPopupCloseEvent(event) {
        if (event.popup === this.popup) {
            this._resetStateToClosed();
        }
    }

    _buildHtmlContent() {
        const site = this.site;
        let popupContent = "<div class='info-window-content'>";
        //
        // Title/site-name
        //
        popupContent += `<div class='title'>${buildPinMarker(site, this.pinned)} ${site.displayName}</div>`;


        //
        // Street Address
        //
        if (Objects.isNotNullOrUndef(site.address.street)) {
            popupContent += site.address.street;
        }

        if (!site.isUserAdded()) {
            popupContent += `<div class='statusLine'>${site.getStallPlugSummary(true)}${site.formatPower(' • ')}`;
    
            //
            // Status, other attributes, limited hours
            //
            var statusDate = site.isOpen() ? dayjs(site.dateOpened) : dayjs().subtract(site.statusDays, 'd');
            var dur = dayjs().to(statusDate, true), days = dayjs().diff(statusDate, 'd');
            if (days <= 0) dur = "today";
            popupContent += ` • <span class="${site.status.className}" title="${site.status.getTitle(site)}${dur.indexOf('day') < 0 ? ` ${days} days` : ''}">`;
            popupContent += `<img class="status" src="${site.status.getIcon(site)}"/> ${dur}</span>`;
    
            if (site.otherEVs || site.solarCanopy || site.battery) popupContent += ' • ';
            // TODO: distinguish NACS vs others?
            if (site.otherEVs)     popupContent += '<img title="other EVs OK" src="/images/car-electric.svg"/>';
            if (site.solarCanopy)  popupContent += '<img title="solar canopy" src="/images/solar-power-variant.svg"/>';
            if (site.battery)      popupContent += '<img title="battery backup" src="/images/battery-charging.svg"/>';

            if (Objects.isNotNullOrUndef(site.hours)) {
                popupContent += `<div class="limited">${site.formatHours()}</div>`; 
            }
            popupContent += "</div>";
        }

        popupContent += "<hr/>";

        if (this.showDetails) {
            popupContent += buildDetailsDiv(site, rangeModel.getDisplayUnit());
        }

        if (this.showHistory) {
            popupContent += _buildHistoryDiv(site);
        }

        popupContent += _buildLinksDiv(site, this.showDetails, this.showHistory, this.mapApi);

        popupContent += "</div>";
        return popupContent;
    }

}


/**
 * This is the content in the InfoWindow that shows up when the user clicks 'details'.
 */
function _buildHistoryDiv(site) {
    let div = "";
    div += `<div class='info-window-details' id='nearby-details-${site.id}'>`;
    div += '<table style="width: 100%;"">';

    div += '<tr style="font-weight:bold;"><td>Date</td><td>Status</td><td class="number">Stalls</td></tr>';

    if (!site.history.length) {
        div += `<tr><td>Unknown</td><td class="${site.status.value.toLowerCase().replace('_','-')}">${site.status.value}</td></tr>`;
    } else {
        div += site.history.map(a => `<tr class="notes"><td>${a.date}</td><td class="${a.siteStatus.toLowerCase().replace('_','-')}">${a.siteStatus}</td><td class="number">${a.stallCount}</td></tr>`).join('');
    }

    div += "</table>";
    div += "<hr/></div>";
    return div;
}

function _buildLinksDiv(site, showDetails, showHistory, mapApi) {
    return '<div class="links">'
        + buildLinkDetailsOrHistory(site, showDetails, showHistory)

        // links that are always present
        + buildLinkZoom(site)
        + buildLinkCircleToggle(site)
        + buildLinkAddToRoute(site)

        // links that are NOT always present.
        + buildLinkDirectToSite(site)
        + (site?.getGmapLink() ?? '')
        + (site?.getPlugShareLink(mapApi) ?? '')
        + (site?.getOsmLink(mapApi) ?? '')
        + buildLinkDiscussURL(site)
        + (site?.getTeslaLink() ?? '')
        + buildLinkRemoveMarker(site)
        + buildLinkRemoveAllMarkers(site)
        + "</div>";
}

function buildLinkZoom(site) {
    return `<a class='zoom-to-site-trigger' href='${site.id}'><img src="/images/zoom-to-site.svg" title="zoom to site" alt="zoom to site"></a>`;
}

function buildLinkCircleToggle(site) {
    // If circles are turned on via the map drop-down menu update the text of our circle on/off label accordingly.
    // We only need one listener for all info windows, not one per info window.
    if (!InfoWindow.circleFlag) {
        EventBus.addListener("circles-all-on-event", function () {
            $("a.circle-toggle-trigger img").attr("title", "circle off");
            $("a.circle-toggle-trigger img").attr("alt", "circle off");
        });
        EventBus.addListener("circles-all-off-event", function () {
            $("a.circle-toggle-trigger img").attr("title", "circle on");
            $("a.circle-toggle-trigger img").attr("alt", "circle on");
        });
        InfoWindow.circleFlag = true;
    }
    const circleOnOffLabel = `circle ${site.circle ? "off" : "on"}`;
    return `<a class='circle-toggle-trigger' href='${site.id}'><img src="/images/circle-center-icon.svg" title="${circleOnOffLabel}" alt="${circleOnOffLabel}"/></a>`;
}

function buildLinkAddToRoute(site) {
    return `<a class='add-to-route-trigger' href='${site.id}'><img src="/images/route.svg" title="add to route" alt="add to route"/></a>`;
}

function buildLinkDirectToSite(site) {
    if (!site.isUserAdded()) {
        return `<a class='direct-link-trigger' href='${site.id}'><img src="/images/link-symbol.svg" title="direct link" alt="direct link"/></a>`;
    }
    return '';
}

function buildLinkDiscussURL(site) {
    if (site.urlDiscuss) {
        return `<a target='_blank' href='${ServiceURL.DISCUSS}?siteId=${site.id}'><img src="/images/forum.svg" title="forum"/></a>`;
    }
    return '';
}

function buildLinkRemoveMarker(site) {
    if (site.isUserAdded()) {
        return `<a class='marker-toggle-trigger' title='remove this custom marker' href='${site.id}'>remove</a>`;
    }
    return '';
}

function buildLinkRemoveAllMarkers(site) {
    if (site.isUserAdded()) {
        return "<a class='marker-toggle-all-trigger' title='remove all custom markers' href=''>remove all</a>";
    }
    return '';
}

function buildLinkDetailsOrHistory(site, showDetails, showHistory) {
    var content = '';
    if (!showDetails) {
        content = `<a class='details-trigger' href='#${site.id}' title="show details">details</a>`;
    } else if (Objects.isNotNullOrUndef(site.history)) {
        content = `<a class='history-trigger' href='#${site.id}' title="show history">history</a>`;
        content += `<a class='details-trigger' href='#${site.id}' title="hide details">×</a>`;
    }
    if (showHistory) {
        content += `<a class='history-trigger' href='#${site.id}' title="hide history">×</a>`;
    }
    return content;
}

function buildPinMarker(site, isPinned) {
    const pinClass = isPinned ? 'unpin' : 'pin';
    return `<a class='pin-marker-trigger pull-right ${pinClass} glyphicon glyphicon-pushpin' title='pin this window' href='#${site.id}'></a>`;
}
