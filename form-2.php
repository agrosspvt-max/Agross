<?php
use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;
use PHPMailer\PHPMailer\SMTP;

// Include PHPMailer library
require 'PHPMailer\src\Exception.php';
require 'PHPMailer\src\PHPMailer.php';
require 'PHPMailer\src\SMTP.php';


// Check if the form is submitted
if ($_SERVER['REQUEST_METHOD'] === 'POST') {

    // Get form data
    $name = $_POST['name'];
    $firm = $_POST['firm'];
    $mobile = $_POST['mobile'];
    $state = $_POST['state'];
    $district = $_POST['district'];
    $teshil = $_POST['teshil'];
    $email = $_POST['email'];
    $dealers = $_POST['dealers'];
    $remark = $_POST['remark'];

    // Create a new PHPMailer instance
    $mail = new PHPMailer(true);

    try {
        // Set SMTP configuration
        $mail->isSMTP();
        $mail->Host = 'smtp-relay.brevo.com'; // Replace with your SMTP server address
        $mail->SMTPAuth = true;
        $mail->Username = getenv('SMTP_USERNAME');
        $mail->Password = getenv('SMTP_PASSWORD');
        $mail->SMTPSecure = 'tls'; // Options: 'ssl' (deprecated) or 'tls'
        $mail->Port = 587; // TCP port to connect to, use 465 for 'ssl'

        // Set email content and recipient
        $mail->setFrom($email); // Set sender's email and name
        $mail->addAddress('info@agross.in'); // Add recipient email and name

        $mail->isHTML(true);
        $mail->Subject = 'Dealership Request';
        $mail->Body = "
            <h3>Dealership Request</h3>
            <p><strong>Name:</strong> $name</p>
            <p><strong>Firm Name:</strong> $firm</p>
            <p><strong>Mobile No:</strong> $mobile</p>
            <p><strong>State:</strong> $state</p>
            <p><strong>District:</strong> $district</p>
            <p><strong>Teshil:</strong> $teshil</p>
            <p><strong>Email:</strong> $email</p>
            <p><strong>Remark:</strong> $remark</p>
        ";

        $mail->send();

        // Redirect to thank you page
        header('Location: https://agross.in/thankyou.html');
        exit;

    } catch (Exception $e) {
        echo "Email could not be sent. Error: {$mail->ErrorInfo}";
    }
}
?>