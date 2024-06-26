import $ from "jquery";
import Address from "../../site/Address";
import SiteCount from "../../site/SiteCount";
import ChartColor from "./ChartColor";
import Highcharts from "highcharts";

export default class CountryBarChart {

    draw() {

        const stateSiteCountList = SiteCount.getCountListByCountry();

        const countryNameList = [];
        const countryOpenCountList = [];
        const countryConstructionCountList = [];
        const countryPlanCountList = [];

        $.each(stateSiteCountList, function (index, value) {
            if (value.key !== Address.COUNTRY_WORLD && value.key !== Address.COUNTRY_USA && value.key !== Address.COUNTRY_CHINA) {
                countryNameList.push(value.key);
                countryOpenCountList.push(value.open);
                countryConstructionCountList.push(value.construction);
                countryPlanCountList.push(value.plan);
            }
        });

        Highcharts.chart("chart-country-bar", {
            chart: {
                style: {
                    fontFamily: "'Roboto Flex', sans-serif"
                },
                type: 'column'
            },
            accessibility: {
                enabled: false
            },
            credits: {
                enabled: false
            },
            title: {
                text: 'Superchargers per Country <span style="color:#aaaaaa">(excluding USA/China)</span>'
            },
            subtitle: {
                text: null
            },
            legend: {
                enabled: true,
                borderWidth: 0,
                reversed: true
            },
            xAxis: {
                categories: countryNameList
            },
            yAxis: {
                title: {
                    text: 'Supercharger Count'
                },
                tickInterval: 5,
                allowDecimals: false
            },
            plotOptions: {
                column: {
                    stacking: 'normal',
                    dataLabels: {
                        enabled: false
                    }
                }
            },
            series: [
                {
                    name: "Plan",
                    data: countryPlanCountList,
                    color: ChartColor.STATUS_PLAN
                },
                {
                    name: "Construction",
                    data: countryConstructionCountList,
                    color: ChartColor.STATUS_CONSTRUCTION
                },
                {
                    name: "Open",
                    data: countryOpenCountList,
                    color: ChartColor.STATUS_OPEN
                }
            ],
            tooltip: {
                shared: true
            }
        });


    }

}

