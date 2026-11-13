const { PRIVACY_TEXT } = require('../../utils/constants.js');

Page({
    data: {
        paragraphs: PRIVACY_TEXT.split('\n'),
        canAgree: false,
    },

    onLoad(options) {
        this.setData({ canAgree: options && options.agree === '1' });
    },

    goBack() {
        wx.navigateBack();
    },
});
