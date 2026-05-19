let timeline = new Timeline("v1_timeline", "data/timeline_data_v1.csv");


const sankey = new Sankey("data/timeline_data_v1.csv", "#sankey", {
    width: 1100,
    height: 420
});

timeline.initVis();
sankey.initVis();

/// Pre-rel: 4
/// EXp: 9
/// Real: 5
/// deep: 3
///commit: 3
/// Md's: 2 --
