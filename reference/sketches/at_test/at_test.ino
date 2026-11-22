#include <SoftwareSerial.h>


SoftwareSerial HC05(8,9);

void setup(){
  pinMode(9,OUTPUT);
  digitalWrite(9,HIGH);
  Serial.begin(9600);  //아두이노-컴퓨터 통신 (ZS-040, 38400)
  HC05.begin(38400);  //아두이노-블루투스통신
}

void loop(){
  if(HC05.available()){
    Serial.write(HC05.read());
  }
  if(Serial.available()){
    HC05.write(Serial.read());
  }
}
