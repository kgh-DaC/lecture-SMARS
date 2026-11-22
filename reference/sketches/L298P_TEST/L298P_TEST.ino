// Motor A (오른쪽 바퀴)
const int DIR_A   = 13;
const int BRAKE_A = 8;
const int PWM_A   = 11;

// Motor B (왼쪽 바퀴)
const int DIR_B   = 12;
const int BRAKE_B = 9;
const int PWM_B   = 10;

int speedValue = 200;   // 0~255

void setup()
{
  Serial.begin(9600);

  pinMode(DIR_A, OUTPUT);
  pinMode(BRAKE_A, OUTPUT);
  pinMode(PWM_A, OUTPUT);

  pinMode(DIR_B, OUTPUT);
  pinMode(BRAKE_B, OUTPUT);
  pinMode(PWM_B, OUTPUT);

  stopAll();

  Serial.println("=== L298P Motor Test ===");
  Serial.println("RF : Right Forward");
  Serial.println("RB : Right Backward");
  Serial.println("LF : Left Forward");
  Serial.println("LB : Left Backward");
  Serial.println("SR : Stop Right");
  Serial.println("SL : Stop Left");
  Serial.println("SA : Stop All");
}

void loop()
{
  if (Serial.available())
  {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    cmd.toUpperCase();

    if(cmd == "RF")
    {
      rightForward();
      stopLeft();
      Serial.println("Right Forward");
    }
    else if(cmd == "RB")
    {
      rightBackward();
      stopLeft();
      Serial.println("Right Backward");
    }
    else if(cmd == "LF")
    {
      leftForward();
      stopRight();
      Serial.println("Left Forward");
    }
    else if(cmd == "LB")
    {
      leftBackward();
      stopRight();
      Serial.println("Left Backward");
    }
    else if(cmd == "SR")
    {
      stopRight();
      Serial.println("Right Stop");
    }
    else if(cmd == "SL")
    {
      stopLeft();
      Serial.println("Left Stop");
    }
    else if(cmd == "SA")
    {
      stopAll();
      Serial.println("All Stop");
    }
    else
    {
      Serial.println("Unknown Command");
    }
  }
}

// ===== 오른쪽 바퀴 =====
void rightForward()
{
  digitalWrite(BRAKE_A, LOW);
  digitalWrite(DIR_A, HIGH);
  analogWrite(PWM_A, speedValue);
}

void rightBackward()
{
  digitalWrite(BRAKE_A, LOW);
  digitalWrite(DIR_A, LOW);
  analogWrite(PWM_A, speedValue);
}

void stopRight()
{
  digitalWrite(BRAKE_A, HIGH);
  analogWrite(PWM_A, 0);
}

// ===== 왼쪽 바퀴 =====
void leftForward()
{
  digitalWrite(BRAKE_B, LOW);
  digitalWrite(DIR_B, HIGH);
  analogWrite(PWM_B, speedValue);
}

void leftBackward()
{
  digitalWrite(BRAKE_B, LOW);
  digitalWrite(DIR_B, LOW);
  analogWrite(PWM_B, speedValue);
}

void stopLeft()
{
  digitalWrite(BRAKE_B, HIGH);
  analogWrite(PWM_B, 0);
}

// ===== 전체 정지 =====
void stopAll()
{
  stopRight();
  stopLeft();
}