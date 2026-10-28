package com.fextesports.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Yerel eklentiler köprü kurulmadan (super.onCreate) önce kaydedilir.
        registerPlugin(BildirimAyarlariPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
